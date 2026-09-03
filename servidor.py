from __future__ import annotations

import os
import threading
import time
from collections import deque
from typing import Any

from flask import Flask, jsonify, make_response, request

from hommy_backend import __version__
from hommy_backend.auth import HommyAuthError, SessionValidator, decode_client_meta, safety_identifier
from hommy_backend.continuity import RealtimeConversationSync, RealtimeSyncUnavailable
from hommy_backend.data import HomeEasyDataStore, HomeEasyDataError
from hommy_backend.engine import HommyEngine, HommyEngineError
from hommy_backend.followup import FollowupError, FollowupPlanner, require_followup_permission
from hommy_backend.realtime import RealtimeError, create_call
from hommy_backend.tools import ToolPermissionError, execute_tool

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

validator = SessionValidator()
data_store = HomeEasyDataStore()
engine: HommyEngine | None = None
realtime_sync: RealtimeConversationSync | None = None
followup_planner: FollowupPlanner | None = None


class HommyRateLimitError(RuntimeError):
    def __init__(self, retry_after: int) -> None:
        super().__init__("Hommy recibió demasiadas solicitudes seguidas. Inténtalo nuevamente en un momento.")
        self.retry_after = max(1, int(retry_after))


class UidRateLimiter:
    """Small in-process limiter for the single-worker staging service; stores only salted UID hashes."""

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, *, limit: int, window_seconds: float = 60.0) -> None:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            events = self._events.setdefault(key, deque())
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                raise HommyRateLimitError(max(1, int(window_seconds - (now - events[0])) + 1))
            events.append(now)
            if len(self._events) > 2_000:
                self._events = {
                    item_key: item_events
                    for item_key, item_events in self._events.items()
                    if item_events and item_events[-1] > cutoff
                }

    def clear(self) -> None:
        with self._lock:
            self._events.clear()


rate_limiter = UidRateLimiter()


def enforce_rate_limit(context, bucket: str, env_name: str, default: int) -> None:
    if not str(getattr(context, "uid", "") or "").strip():
        return
    limit = max(1, min(int(os.getenv(env_name, str(default))), 600))
    rate_limiter.check(f"{bucket}:{safety_identifier(context)}", limit=limit)


def get_engine() -> HommyEngine:
    global engine
    if engine is None:
        engine = HommyEngine(data_store)
    return engine


def get_realtime_sync() -> RealtimeConversationSync:
    global realtime_sync
    hommy_engine = get_engine()
    if realtime_sync is None or realtime_sync.engine is not hommy_engine:
        realtime_sync = RealtimeConversationSync(hommy_engine)
    return realtime_sync


def get_followup_planner() -> FollowupPlanner:
    global followup_planner
    if followup_planner is None:
        followup_planner = FollowupPlanner()
    return followup_planner


def allowed_origins() -> set[str]:
    return {
        item.strip().rstrip("/")
        for item in os.getenv(
            "HOMMY_ALLOWED_ORIGINS",
            "https://alejoherrera05-del.github.io,http://localhost:8000,http://127.0.0.1:8000",
        ).split(",")
        if item.strip()
    }


@app.after_request
def cors_headers(response):
    origin = str(request.headers.get("Origin") or "").rstrip("/")
    if origin and origin in allowed_origins():
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-HomeEasy-Session, X-HomeEasy-Meta"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "600"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options_route(_path: str):
    return ("", 204)


def auth_context():
    return validator.validate(
        request.headers.get("X-HomeEasy-Session", ""),
        client_meta=decode_client_meta(request.headers.get("X-HomeEasy-Meta", "")),
    )


def json_error(message: str, code: str, status: int):
    return jsonify({"ok": False, "error": {"code": code, "message": message}}), status


def log_timing(route: str, *, auth_ms: float = 0, data_ms: float = 0, openai_ms: float = 0,
               tools_ms: float = 0, total_ms: float = 0, rounds: int = 0) -> None:
    """Emit aggregate latency only; never prompts, tool arguments, PII or identifiers."""
    app.logger.info(
        "hommy_timing route=%s auth_ms=%.1f data_ms=%.1f openai_ms=%.1f "
        "tools_ms=%.1f total_ms=%.1f rounds=%d",
        route,
        auth_ms,
        data_ms,
        openai_ms,
        tools_ms,
        total_ms,
        rounds,
    )


@app.errorhandler(HommyAuthError)
def handle_auth(error: HommyAuthError):
    return json_error(str(error), error.code, error.status_code)


@app.errorhandler(ToolPermissionError)
def handle_permission(error: ToolPermissionError):
    return json_error(str(error), "PERMISSION_DENIED", 403)


@app.errorhandler(HomeEasyDataError)
def handle_data(error: HomeEasyDataError):
    return json_error(str(error), "DATA_UNAVAILABLE", 503)


@app.errorhandler(HommyEngineError)
def handle_engine(error: HommyEngineError):
    return json_error(str(error), "HOMMY_ERROR", 400)


@app.errorhandler(FollowupError)
def handle_followup(error: FollowupError):
    return json_error(str(error), error.code, error.status_code)


@app.errorhandler(RealtimeSyncUnavailable)
def handle_realtime_sync_unavailable(error: RealtimeSyncUnavailable):
    response, status = json_error(str(error), "VOICE_SYNC_UNAVAILABLE", 503)
    response.headers["Retry-After"] = "1"
    return response, status


@app.errorhandler(RealtimeError)
def handle_realtime(error: RealtimeError):
    return json_error(str(error), "REALTIME_ERROR", 502)


@app.errorhandler(HommyRateLimitError)
def handle_rate_limit(error: HommyRateLimitError):
    response, status = json_error(str(error), "RATE_LIMITED", 429)
    response.headers["Retry-After"] = str(error.retry_after)
    return response, status


@app.get("/")
@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "service": "Hommy",
        "version": __version__,
        "model": os.getenv("HOMMY_MODEL", "gpt-5.6-terra"),
        "voiceModel": os.getenv("HOMMY_REALTIME_MODEL", "gpt-realtime-2.1"),
        "time": int(time.time()),
    })


@app.post("/api/hommy/chat", provide_automatic_options=False)
def hommy_chat():
    started = time.perf_counter()
    auth_started = time.perf_counter()
    context = auth_context()
    enforce_rate_limit(context, "chat", "HOMMY_RATE_CHAT_PER_MINUTE", 20)
    auth_ms = (time.perf_counter() - auth_started) * 1000
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    hommy_engine = get_engine()
    result = hommy_engine.chat(payload.get("message", ""), context, payload.get("conversationToken"))
    metrics = hommy_engine.consume_internal_metrics()
    log_timing(
        "chat",
        auth_ms=auth_ms,
        data_ms=float(metrics.get("tools_ms") or 0),
        openai_ms=float(metrics.get("openai_ms") or 0),
        tools_ms=float(metrics.get("tools_ms") or 0),
        total_ms=(time.perf_counter() - started) * 1000,
        rounds=int(metrics.get("rounds") or 0),
    )
    return jsonify({"ok": True, **result})


@app.post("/api/hommy/bootstrap", provide_automatic_options=False)
def hommy_bootstrap():
    started = time.perf_counter()
    auth_started = time.perf_counter()
    auth_context()
    auth_ms = (time.perf_counter() - auth_started) * 1000
    data_started = time.perf_counter()
    metadata = data_store.bootstrap()
    data_ms = (time.perf_counter() - data_started) * 1000
    log_timing(
        "bootstrap",
        auth_ms=auth_ms,
        data_ms=data_ms,
        total_ms=(time.perf_counter() - started) * 1000,
    )
    return jsonify({"ok": True, **metadata})


@app.post("/api/hommy/tool", provide_automatic_options=False)
def hommy_tool():
    started = time.perf_counter()
    auth_started = time.perf_counter()
    context = auth_context()
    enforce_rate_limit(context, "tool", "HOMMY_RATE_TOOL_PER_MINUTE", 60)
    auth_ms = (time.perf_counter() - auth_started) * 1000
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "")
    arguments = payload.get("arguments") if isinstance(payload.get("arguments"), dict) else {}
    data_started = time.perf_counter()
    result = execute_tool(name, arguments, context, data_store)
    data_ms = (time.perf_counter() - data_started) * 1000
    log_timing("tool", auth_ms=auth_ms, data_ms=data_ms, tools_ms=data_ms, total_ms=(time.perf_counter() - started) * 1000)
    return jsonify({"ok": True, "result": result})


@app.post("/api/hommy/followup/plan", provide_automatic_options=False)
def hommy_followup_plan():
    started = time.perf_counter()
    auth_started = time.perf_counter()
    context = auth_context()
    require_followup_permission(context)
    enforce_rate_limit(context, "followup-plan", "HOMMY_RATE_FOLLOWUP_PER_MINUTE", 12)
    auth_ms = (time.perf_counter() - auth_started) * 1000

    payload: dict[str, Any] = request.get_json(silent=True) or {}
    quote_number = str(payload.get("numero") or payload.get("quoteNumber") or "").strip()

    # Deliberately ignore any client-supplied quote/customer/context fields. 10B
    # rereads the canonical opportunity from HomeEasy using the authenticated session.
    result = get_followup_planner().plan(
        quote_number,
        context,
        session_token=request.headers.get("X-HomeEasy-Session", ""),
        client_meta=decode_client_meta(request.headers.get("X-HomeEasy-Meta", "")),
    )
    log_timing(
        "followup_plan",
        auth_ms=auth_ms,
        total_ms=(time.perf_counter() - started) * 1000,
    )
    return jsonify({"ok": True, **result})


@app.post("/api/hommy/realtime/session", provide_automatic_options=False)
def hommy_realtime_session():
    started = time.perf_counter()
    auth_started = time.perf_counter()
    context = auth_context()
    enforce_rate_limit(context, "realtime-session", "HOMMY_RATE_REALTIME_SESSION_PER_MINUTE", 8)
    auth_ms = (time.perf_counter() - auth_started) * 1000
    answer = create_call(request.get_data(as_text=True), context)
    log_timing("realtime_session", auth_ms=auth_ms, openai_ms=(time.perf_counter() - started) * 1000 - auth_ms, total_ms=(time.perf_counter() - started) * 1000)
    response = make_response(answer, 200)
    response.headers["Content-Type"] = "application/sdp"
    return response


@app.post("/api/hommy/realtime/sync", provide_automatic_options=False)
def hommy_realtime_sync():
    started = time.perf_counter()
    auth_started = time.perf_counter()
    context = auth_context()
    enforce_rate_limit(context, "realtime-sync", "HOMMY_RATE_SYNC_PER_MINUTE", 60)
    auth_ms = (time.perf_counter() - auth_started) * 1000
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    openai_started = time.perf_counter()
    result = get_realtime_sync().sync(
        context,
        payload.get("conversationToken"),
        payload.get("turns"),
    )
    openai_ms = (time.perf_counter() - openai_started) * 1000
    log_timing(
        "realtime_sync",
        auth_ms=auth_ms,
        openai_ms=openai_ms,
        total_ms=(time.perf_counter() - started) * 1000,
    )
    return jsonify({"ok": True, **result})


@app.post("/api/chat", provide_automatic_options=False)
def legacy_chat_disabled():
    return json_error("Este cliente de Hommy está desactualizado. Abre Hommy desde HomeEasy.", "CLIENT_UPGRADE_REQUIRED", 426)


@app.post("/api/tts", provide_automatic_options=False)
def legacy_tts_disabled():
    return json_error("La voz anterior fue reemplazada por Hommy Realtime.", "CLIENT_UPGRADE_REQUIRED", 426)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
