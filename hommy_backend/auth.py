from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Iterable

import requests

DEFAULT_HOMEEASY_BACKEND = (
    "https://script.google.com/macros/s/"
    "AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec"
)

_ALLOWED_META_FIELDS = (
    "operador",
    "dispositivoId",
    "dispositivoNombre",
    "plataforma",
    "navegador",
    "pagina",
    "versionApp",
    "horaCliente",
)


class HommyAuthError(RuntimeError):
    def __init__(self, message: str, code: str = "AUTH_REQUIRED", status_code: int = 401):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class AuthContext:
    uid: str
    name: str
    email: str
    role: str
    permissions: frozenset[str]

    @property
    def first_name(self) -> str:
        clean = self.name.strip()
        return clean.split()[0] if clean else ""

    def has(self, permission: str) -> bool:
        return "*" in self.permissions or permission in self.permissions

    def has_any(self, permissions: Iterable[str]) -> bool:
        required = tuple(permissions)
        return not required or "*" in self.permissions or any(p in self.permissions for p in required)


def decode_client_meta(value: str) -> dict[str, str]:
    """Decode the browser HomeEasy meta header without trusting arbitrary fields."""
    raw = str(value or "").strip()
    if not raw or len(raw) > 4096:
        return {}
    try:
        padded = raw.replace("-", "+").replace("_", "/")
        padded += "=" * ((4 - len(padded) % 4) % 4)
        payload = json.loads(base64.b64decode(padded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    clean: dict[str, str] = {}
    for field in _ALLOWED_META_FIELDS:
        text = str(payload.get(field) or "").replace("\r", " ").replace("\n", " ").strip()
        if text:
            clean[field] = text[:180]
    return clean


class SessionValidator:
    """Validates opaque HomeEasy sessions against the existing Apps Script auth backend."""

    def __init__(self) -> None:
        self.backend_url = os.getenv("HOMEEASY_BACKEND_URL", DEFAULT_HOMEEASY_BACKEND).strip()
        self.cache_ttl = max(10, int(os.getenv("HOMMY_AUTH_CACHE_SECONDS", "45")))
        self.timeout = max(3, int(os.getenv("HOMMY_AUTH_TIMEOUT_SECONDS", "12")))
        self._cache: dict[str, tuple[float, AuthContext]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _cache_key(token: str, device_id: str) -> str:
        return hashlib.sha256(f"{token}:{device_id}".encode("utf-8")).hexdigest()

    def _from_cache(self, token: str, device_id: str) -> AuthContext | None:
        key = self._cache_key(token, device_id)
        now = time.monotonic()
        with self._lock:
            item = self._cache.get(key)
            if not item:
                return None
            expires, context = item
            if expires <= now:
                self._cache.pop(key, None)
                return None
            return context

    def _store_cache(self, token: str, device_id: str, context: AuthContext) -> None:
        with self._lock:
            self._cache[self._cache_key(token, device_id)] = (time.monotonic() + self.cache_ttl, context)
            if len(self._cache) > 500:
                now = time.monotonic()
                self._cache = {k: v for k, v in self._cache.items() if v[0] > now}

    def validate(
        self,
        token: str,
        *,
        page: str = "Hommychat.html",
        client_meta: dict[str, Any] | None = None,
    ) -> AuthContext:
        token = str(token or "").strip()
        if not token:
            raise HommyAuthError("Tu sesión de HomeEasy no está disponible.")

        source_meta = client_meta if isinstance(client_meta, dict) else {}
        clean_meta = {
            field: str(source_meta.get(field) or "").replace("\r", " ").replace("\n", " ").strip()[:180]
            for field in _ALLOWED_META_FIELDS
            if str(source_meta.get(field) or "").strip()
        }
        device_id = clean_meta.get("dispositivoId", "")

        cached = self._from_cache(token, device_id)
        if cached:
            return cached

        payload = {
            "tipo": "AUTH_VALIDAR_SESION",
            "appSessionToken": token,
            "meta": {
                **clean_meta,
                "pagina": page,
                "versionApp": "hommy-2.0",
                "origen": "hommy-backend",
            },
        }
        try:
            # HomeEasy's browser client posts a JSON string without a custom JSON
            # content type. Fetch serializes that body as UTF-8 text/plain. Mirror
            # the same wire format server-to-server so Apps Script parses mobile
            # and desktop sessions identically.
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            response = requests.post(
                self.backend_url,
                data=body,
                headers={
                    "Content-Type": "text/plain;charset=UTF-8",
                    "Accept": "application/json",
                },
                timeout=self.timeout,
                allow_redirects=True,
            )
            response.raise_for_status()
            data = response.json()
        except requests.Timeout as exc:
            raise HommyAuthError(
                "HomeEasy tardó demasiado en validar tu sesión.",
                "AUTH_UPSTREAM_TIMEOUT",
                503,
            ) from exc
        except (requests.RequestException, ValueError) as exc:
            raise HommyAuthError(
                "No fue posible validar tu sesión con HomeEasy.",
                "AUTH_UPSTREAM_UNAVAILABLE",
                503,
            ) from exc

        if not data or data.get("status") != "success" or data.get("valido") is not True:
            message = str((data or {}).get("msg") or "Tu sesión de HomeEasy venció.")
            raw_code = str((data or {}).get("code") or "").strip()
            if raw_code:
                code = raw_code
                status = 403 if code == "PERMISSION_DENIED" else 401
            elif "JSON" in message.upper() or "SOLICITUD NO CONTIENE" in message.upper():
                code = "AUTH_UPSTREAM_INVALID_REQUEST"
                status = 502
            else:
                code = "APP_SESSION_EXPIRED"
                status = 401
            raise HommyAuthError(message, code, status)

        profile = data.get("perfil") or {}
        permissions = frozenset(str(p).strip() for p in (data.get("permisos") or []) if str(p).strip())
        context = AuthContext(
            uid=str(profile.get("uid") or "").strip(),
            name=str(profile.get("nombre") or "").strip(),
            email=str(profile.get("email") or "").strip().lower(),
            role=str(profile.get("rol") or "").strip().upper(),
            permissions=permissions,
        )
        if not context.uid:
            raise HommyAuthError("HomeEasy no devolvió una identidad válida.", "INVALID_PROFILE", 401)
        if not context.has("app.access"):
            raise HommyAuthError("Tu rol no tiene acceso a Hommy.", "PERMISSION_DENIED", 403)

        self._store_cache(token, device_id, context)
        return context


def safety_identifier(context: AuthContext) -> str:
    salt = os.getenv("HOMMY_SAFETY_SALT", "homeeasy-hommy-v2")
    value = f"{salt}:{context.uid}".encode("utf-8")
    return hashlib.sha256(value).hexdigest()
