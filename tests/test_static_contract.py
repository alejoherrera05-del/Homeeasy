from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StaticContractTests(unittest.TestCase):
    def test_frontend_security_contract(self):
        html = (ROOT / 'Hommychat.html').read_text(encoding='utf-8')
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        self.assertNotIn('user-scalable=no', html)
        self.assertNotIn('marked', html.lower())
        self.assertNotIn('SpeechRecognition', js)
        self.assertNotIn('.innerHTML', js)
        self.assertIn('X-HomeEasy-Session', js)
        self.assertIn('X-HomeEasy-Meta', js)
        self.assertIn('HomeEasyCore.buildMeta', js)
        self.assertIn('RTCPeerConnection', js)
        self.assertIn('homeeasy-page-guard.js?v=3.4', html)

    def test_text_context_is_carried_into_realtime_voice(self):
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        self.assertIn('seedVoiceHistory', js)
        self.assertIn('MAX_VOICE_CONTEXT_MESSAGES', js)
        self.assertIn("type: 'conversation.item.create'", js)
        self.assertIn("'output_text'", js)
        self.assertIn("'input_text'", js)

    def test_backend_has_no_embedded_provider_secret(self):
        sources = '\n'.join(path.read_text(encoding='utf-8') for path in [ROOT / 'servidor.py', *sorted((ROOT / 'hommy_backend').glob('*.py'))])
        self.assertIsNone(re.search(r'sk-[A-Za-z0-9_-]{16,}', sources))
        self.assertNotIn('ELEVENLABS_API_KEY =', sources)
        self.assertIn('openai_api_key()', sources)

    def test_session_validation_preserves_device_binding(self):
        server = (ROOT / 'servidor.py').read_text(encoding='utf-8')
        auth = (ROOT / 'hommy_backend' / 'auth.py').read_text(encoding='utf-8')
        self.assertIn('X-HomeEasy-Meta', server)
        self.assertIn('decode_client_meta', server)
        self.assertIn('dispositivoId', auth)
        self.assertIn('device_id', auth)

    def test_legacy_unauthenticated_endpoints_are_disabled(self):
        server = (ROOT / 'servidor.py').read_text(encoding='utf-8')
        self.assertIn('CLIENT_UPGRADE_REQUIRED', server)
        self.assertIn('/api/hommy/chat', server)
        self.assertIn('/api/hommy/realtime/session', server)


if __name__ == '__main__': unittest.main(verbosity=2)
