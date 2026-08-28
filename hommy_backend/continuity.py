from __future__ import annotations

import re
import threading
import time
from typing import Any

from .auth import AuthContext
from .engine import HommyEngine, HommyEngineError


_TURN_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class RealtimeSyncUnavailable(RuntimeError):
    """Transient upstream failure while persisting final voice turns."""


class RealtimeConversationSync:
    """Append final Realtime transcripts to the signed Responses conversation.

    The browser may retry a batch after a network interruption. A small in-memory
    idempotency window prevents duplicate turns without persisting transcript text.
    """

    def __init__(self, engine: HommyEngine) -> None:
        self.engine = engine
        self._lock = threading.Lock()
        self._seen: dict[tuple[str, str, str], float] = {}
        self._conversation_locks: dict[tuple[str, str], threading.Lock] = {}
        self._seen_ttl = 2 * 60 * 60

    @staticmethod
    def _validated_turns(value: Any) -> list[dict[str, str]]:
        if not isinstance(value, list) or not value or len(value) > 12:
            raise HommyEngineError("La sincronización de voz no contiene turnos válidos.")
        turns: list[dict[str, str]] = []
        total_length = 0
        for raw in value:
            if not isinstance(raw, dict) or set(raw) - {"id", "role", "text"}:
                raise HommyEngineError("La sincronización de voz contiene campos no permitidos.")
            turn_id = str(raw.get("id") or "").strip()
            role = str(raw.get("role") or "").strip().lower()
            text = str(raw.get("text") or "").replace("\x00", "").strip()
            if not _TURN_ID.fullmatch(turn_id) or role not in {"user", "assistant"}:
                raise HommyEngineError("La sincronización de voz contiene un turno inválido.")
            if not text or len(text) > 2400:
                raise HommyEngineError("Una transcripción de voz está vacía o es demasiado larga.")
            total_length += len(text)
            if total_length > 12_000:
                raise HommyEngineError("La sincronización de voz es demasiado extensa.")
            turns.append({"id": turn_id, "role": role, "text": text})
        return turns

    def _conversation(self, context: AuthContext, token: str | None) -> tuple[str, str]:
        supplied = str(token or "").strip()
        if supplied:
            conversation_id = self.engine.signer.verify(supplied, context.uid)
            if not conversation_id:
                raise HommyEngineError("La conversación de voz no es válida para esta sesión.")
            return conversation_id, self.engine.signer.sign(conversation_id, context.uid)
        return self.engine._conversation(context, None)

    def sync(
        self,
        context: AuthContext,
        conversation_token: str | None,
        turns_value: Any,
    ) -> dict[str, Any]:
        turns = self._validated_turns(turns_value)
        conversation_id, signed_token = self._conversation(context, conversation_token)
        with self._lock:
            conversation_lock = self._conversation_locks.setdefault(
                (conversation_id, context.uid),
                threading.Lock(),
            )

        with conversation_lock:
            now = time.monotonic()
            with self._lock:
                if len(self._seen) > 512:
                    self._seen = {
                        key: timestamp
                        for key, timestamp in self._seen.items()
                        if now - timestamp < self._seen_ttl
                    }
                pending = [
                    turn
                    for turn in turns
                    if (conversation_id, context.uid, turn["id"]) not in self._seen
                ]
                for turn in pending:
                    self._seen[(conversation_id, context.uid, turn["id"])] = now

            if not pending:
                return {"conversationToken": signed_token, "synced": 0}

            try:
                self.engine.client.conversations.items.create(
                    conversation_id,
                    items=[{"role": turn["role"], "content": turn["text"]} for turn in pending],
                )
            except Exception as exc:
                with self._lock:
                    for turn in pending:
                        self._seen.pop((conversation_id, context.uid, turn["id"]), None)
                raise RealtimeSyncUnavailable("No fue posible conservar la continuidad de la conversación por voz.") from exc

        return {"conversationToken": signed_token, "synced": len(pending)}
