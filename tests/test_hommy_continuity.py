import types
import threading
import unittest

from hommy_backend.auth import AuthContext
from hommy_backend.continuity import RealtimeConversationSync, RealtimeSyncUnavailable
from hommy_backend.engine import HommyEngineError


class FakeSigner:
    def verify(self, token, uid):
        return "conv_test" if token == f"valid:{uid}" else None

    def sign(self, conversation_id, uid):
        return f"signed:{conversation_id}:{uid}"


class FakeItems:
    def __init__(self):
        self.calls = []

    def create(self, conversation_id, *, items):
        self.calls.append((conversation_id, items))
        return object()


class FakeEngine:
    def __init__(self):
        self.signer = FakeSigner()
        self.items = FakeItems()
        self.client = types.SimpleNamespace(
            conversations=types.SimpleNamespace(items=self.items)
        )

    def _conversation(self, context, token):
        return "conv_new", f"signed:conv_new:{context.uid}"


class RealtimeContinuityTests(unittest.TestCase):
    def setUp(self):
        self.context = AuthContext("u1", "Usuario", "u@example.com", "TEST", frozenset({"app.access"}))
        self.engine = FakeEngine()
        self.sync = RealtimeConversationSync(self.engine)

    def test_sync_appends_only_allowed_final_turn_fields(self):
        result = self.sync.sync(
            self.context,
            "valid:u1",
            [
                {"id": "item_user_1", "role": "user", "text": "¿Cuál fue la última venta?"},
                {"id": "item_assistant_1", "role": "assistant", "text": "La OP más reciente fue la 40."},
            ],
        )
        self.assertEqual(result["synced"], 2)
        conversation_id, items = self.engine.items.calls[0]
        self.assertEqual(conversation_id, "conv_test")
        self.assertEqual(set(items[0]), {"role", "content"})
        self.assertNotIn("item_user_1", str(items))

    def test_retry_is_idempotent_inside_server_window(self):
        turns = [{"id": "same_id", "role": "user", "text": "Hola"}]
        self.assertEqual(self.sync.sync(self.context, "valid:u1", turns)["synced"], 1)
        self.assertEqual(self.sync.sync(self.context, "valid:u1", turns)["synced"], 0)
        self.assertEqual(len(self.engine.items.calls), 1)

    def test_token_bound_to_another_user_is_rejected(self):
        with self.assertRaises(HommyEngineError):
            self.sync.sync(self.context, "valid:other", [{"id": "x", "role": "user", "text": "Hola"}])

    def test_untrusted_roles_fields_and_sizes_are_rejected(self):
        invalid_batches = [
            [{"id": "x", "role": "tool", "text": "no"}],
            [{"id": "x", "role": "user", "text": "ok", "tool_output": "no"}],
            [{"id": "x", "role": "user", "text": "x" * 2401}],
        ]
        for batch in invalid_batches:
            with self.subTest(batch=list(batch[0])):
                with self.assertRaises(HommyEngineError):
                    self.sync.sync(self.context, "valid:u1", batch)

    def test_transient_upstream_failure_remains_retryable(self):
        turns = [{"id": "retry_id", "role": "user", "text": "Hola"}]
        original = self.engine.items.create
        self.engine.items.create = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("upstream timeout"))
        with self.assertRaises(RealtimeSyncUnavailable):
            self.sync.sync(self.context, "valid:u1", turns)
        self.engine.items.create = original
        self.assertEqual(self.sync.sync(self.context, "valid:u1", turns)["synced"], 1)

    def test_concurrent_retry_never_acknowledges_an_inflight_batch_early(self):
        entered = threading.Event()
        release = threading.Event()
        second_finished = threading.Event()
        calls = 0
        original = self.engine.items.create

        def blocking_create(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                entered.set()
                self.assertTrue(release.wait(2))
                raise RuntimeError("first attempt failed")
            return original(*args, **kwargs)

        self.engine.items.create = blocking_create
        turns = [{"id": "concurrent_id", "role": "user", "text": "Hola"}]
        outcomes = []

        def run_first():
            try:
                self.sync.sync(self.context, "valid:u1", turns)
            except RealtimeSyncUnavailable:
                outcomes.append("first_failed")

        def run_second():
            outcomes.append(self.sync.sync(self.context, "valid:u1", turns)["synced"])
            second_finished.set()

        first = threading.Thread(target=run_first)
        second = threading.Thread(target=run_second)
        first.start()
        self.assertTrue(entered.wait(1))
        second.start()
        self.assertFalse(second_finished.wait(0.05))
        release.set()
        first.join(2)
        second.join(2)

        self.assertEqual(calls, 2)
        self.assertCountEqual(outcomes, ["first_failed", 1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
