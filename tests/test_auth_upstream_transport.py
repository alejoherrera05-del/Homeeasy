from pathlib import Path
import unittest


class AuthUpstreamTransportTests(unittest.TestCase):
    def test_apps_script_validation_uses_browser_compatible_utf8_text_body(self):
        source = (Path(__file__).resolve().parents[1] / 'hommy_backend' / 'auth.py').read_text(encoding='utf-8')
        self.assertIn('json.dumps(payload, ensure_ascii=False).encode("utf-8")', source)
        self.assertIn('"Content-Type": "text/plain;charset=UTF-8"', source)
        self.assertIn('AUTH_UPSTREAM_INVALID_REQUEST', source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
