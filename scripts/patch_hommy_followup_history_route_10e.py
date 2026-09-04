from pathlib import Path

path = Path('servidor.py')
source = path.read_text(encoding='utf-8')
anchor = '''    return jsonify({"ok": True, **result})\n\n\n@app.post("/api/hommy/realtime/session", provide_automatic_options=False)\ndef hommy_realtime_session():\n'''
route = '''    return jsonify({"ok": True, **result})\n\n\n@app.post("/api/hommy/followup/history", provide_automatic_options=False)\ndef hommy_followup_history():\n    started = time.perf_counter()\n    auth_started = time.perf_counter()\n    context = followup_auth_context()\n    require_followup_permission(context)\n    enforce_rate_limit(context, "followup-history", "HOMMY_RATE_FOLLOWUP_HISTORY_PER_MINUTE", 20)\n    auth_ms = (time.perf_counter() - auth_started) * 1000\n\n    payload: dict[str, Any] = request.get_json(silent=True) or {}\n    quote_number = str(payload.get("numero") or payload.get("quoteNumber") or "").strip()\n    result = get_followup_planner().history(\n        quote_number,\n        context,\n        session_token=request.headers.get("X-HomeEasy-Session", ""),\n        client_meta=decode_client_meta(request.headers.get("X-HomeEasy-Meta", "")),\n    )\n    log_timing(\n        "followup_history",\n        auth_ms=auth_ms,\n        total_ms=(time.perf_counter() - started) * 1000,\n    )\n    return jsonify({"ok": True, **result})\n\n\n@app.post("/api/hommy/realtime/session", provide_automatic_options=False)\ndef hommy_realtime_session():\n'''
if source.count(anchor) != 1:
    raise SystemExit(f'history route anchor mismatch: {source.count(anchor)}')
path.write_text(source.replace(anchor, route, 1), encoding='utf-8')
