from __future__ import annotations

import unittest
from pathlib import Path


class CanonicalHommyTreeTests(unittest.TestCase):
    def test_legacy_hommy_entrypoints_are_removed(self):
        root = Path(__file__).resolve().parents[1]
        for name in ("asistente.html", "cerebro.py", "buscador.py", "utilidades.py"):
            self.assertFalse((root / name).exists(), f"legacy Hommy artifact must stay removed: {name}")
        guard = (root / "homeeasy-page-guard.js").read_text(encoding="utf-8")
        self.assertNotIn("asistente.html", guard)

    def test_current_hommy_2_backend_and_frontend_remain(self):
        root = Path(__file__).resolve().parents[1]
        self.assertTrue((root / "Hommychat.html").exists())
        self.assertTrue((root / "hommy-chat.js").exists())
        self.assertTrue((root / "hommy_backend" / "engine.py").exists())
        server = (root / "servidor.py").read_text(encoding="utf-8")
        self.assertIn("from hommy_backend", server)
        self.assertNotIn("ELEVENLABS", server.upper())
        self.assertNotIn("CHAT_AGENTE", server)

    def test_page_guard_loads_current_session_bridge(self):
        root = Path(__file__).resolve().parents[1]
        guard = (root / "homeeasy-page-guard.js").read_text(encoding="utf-8")
        self.assertIn("homeeasy-auth-config.js?v=3.2", guard)
        self.assertIn("HomeEasy Page Guard v3.5", guard)


if __name__ == "__main__":
    unittest.main()
