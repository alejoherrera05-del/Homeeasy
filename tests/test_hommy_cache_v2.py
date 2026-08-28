import threading
import time
import unittest
from unittest.mock import patch

from hommy_backend.data import HomeEasyDataError, HomeEasyDataStore, Snapshot


def snapshot(loaded_at=None):
    moment = time.time() if loaded_at is None else loaded_at
    return Snapshot(moment, {}, [], [], {}, [], [], "2026-08-28T10:00:00-05:00")


class HommyCacheTests(unittest.TestCase):
    def test_fresh_snapshot_does_not_reload(self):
        store = HomeEasyDataStore()
        store.ttl = 60
        store._snapshot = snapshot()
        with patch.object(store, "_load", side_effect=AssertionError("network should not run")):
            result = store.snapshot()
        self.assertFalse(result.stale)

    def test_stale_snapshot_returns_immediately_and_refreshes_single_flight(self):
        store = HomeEasyDataStore()
        store.ttl = 5
        store.stale_ttl = 180
        store._snapshot = snapshot(time.time() - 30)
        started = threading.Event()
        release = threading.Event()
        calls = []

        def slow_load():
            calls.append(1)
            started.set()
            release.wait(2)
            return snapshot()

        with patch.object(store, "_load", side_effect=slow_load):
            first = store.snapshot()
            second = store.snapshot()
            self.assertTrue(first.stale)
            self.assertTrue(second.stale)
            self.assertTrue(started.wait(1))
            self.assertEqual(len(calls), 1)
            release.set()
            deadline = time.time() + 2
            while store.cache_status()["refreshing"] and time.time() < deadline:
                time.sleep(0.01)
            refreshed = store.snapshot()
        self.assertFalse(refreshed.stale)
        self.assertEqual(len(calls), 1)

    def test_force_or_financial_refresh_does_not_silently_return_stale_on_error(self):
        store = HomeEasyDataStore()
        store.ttl = 5
        store.stale_ttl = 180
        store._snapshot = snapshot(time.time() - 30)
        with patch.object(store, "_load", side_effect=RuntimeError("upstream")):
            with self.assertRaises(HomeEasyDataError):
                store.snapshot(force=True)
            with self.assertRaises(HomeEasyDataError):
                store.snapshot(require_fresh=True)

    def test_waiting_for_an_existing_refresh_has_a_deadline(self):
        store = HomeEasyDataStore()
        store.refresh_wait_timeout = 0.02
        store._refreshing = True
        started = time.monotonic()
        with self.assertRaisesRegex(HomeEasyDataError, "tiempo de espera"):
            store._blocking_refresh(None, allow_stale=False)
        self.assertLess(time.monotonic() - started, 0.5)

    def test_bootstrap_returns_metadata_only(self):
        store = HomeEasyDataStore()
        store._snapshot = snapshot()
        result = store.bootstrap()
        self.assertEqual(set(result), {"ready", "dataUpdatedAt", "stale", "ageSeconds", "refreshing"})
        self.assertTrue(result["ready"])
        self.assertNotIn("orders", result)
        self.assertNotIn("clients", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
