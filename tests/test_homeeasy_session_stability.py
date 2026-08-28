from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


class HomeEasySessionStabilityTests(unittest.TestCase):
    def test_long_lived_operational_session_survives_firebase_token_expiry(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            ["node", "tests/homeeasy-session-stability.mjs"],
            cwd=root,
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"Node stability contract failed.\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )
        self.assertIn("HomeEasy long-lived session stability: PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
