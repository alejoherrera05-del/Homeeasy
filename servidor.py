from __future__ import annotations

import os
import time
from typing import Any

from flask import Flask, jsonify, make_response, request

from hommy_backend import __version__
from hommy_backend.auth import HommyAuthError, SessionValidator, decode_client_meta
from hommy_backend.data import HomeEasyDataStore, HomeEasyDataError
from hommy_backend.engine import HommyEngine, HommyEngineError
from hommy_backend.realtime import RealtimeError, create_call
from hommy_backend.tools import ToolPermissionError, execute_tool

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

validator = SessionValidator()
data_store = HomeEasyDataStore()
engine: HommyEngine | None = None


def get_engine() -> HommyEngine:
    global engine
    if engine is None:
        engine = HommyEngine(data_store)
    return engine


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
        response.headers["Access-Control-Allow-Credentials"] = "false"
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


@app.errorhandler(RealtimeError)
def handle_realtime(error: RealtimeError):
    return json_error(str(error), "REALTIME_ERROR", 502)


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
    context = auth_context()
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    result = get_engine().chat(payload.get("message", ""), context, payload.get("conversationToken"))
    return jsonify({"ok": True, **result})


@app.post("/api/hommy/tool", provide_automatic_options=False)
def hommy_tool():
    context = auth_context()
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "")
    arguments = payload.get("arguments") if isinstance(payload.get("arguments"), dict) else {}
    return jsonify({"ok": True, "result": execute_tool(name, arguments, context, data_store)})


@app.post("/api/hommy/realtime/session", provide_automatic_options=False)
def hommy_realtime_session():
    context = auth_context()
    answer = create_call(request.get_data(as_text=True), context)
    response = make_response(answer, 200)
    response.headers["Content-Type"] = "application/sdp"
    return response


@app.post("/api/chat", provide_automatic_options=False)
def legacy_chat_disabled():
    return json_error("Este cliente de Hommy está desactualizado. Abre Hommy desde HomeEasy.", "CLIENT_UPGRADE_REQUIRED", 426)


@app.post("/api/tts", provide_automatic_options=False)
def legacy_tts_disabled():
    return json_error("La voz anterior fue reemplazada por Hommy Realtime.", "CLIENT_UPGRADE_REQUIRED", 426)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
