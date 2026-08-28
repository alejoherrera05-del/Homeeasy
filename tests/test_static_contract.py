from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StaticContractTests(unittest.TestCase):
    def test_frontend_security_contract(self):
        html = (ROOT / 'Hommychat.html').read_text(encoding='utf-8')
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        richtext = (ROOT / 'hommy-richtext.js').read_text(encoding='utf-8')
        self.assertNotIn('user-scalable=no', html)
        self.assertNotIn('marked', html.lower())
        self.assertNotIn('SpeechRecognition', js)
        self.assertNotIn('.innerHTML', js)
        self.assertNotIn('.innerHTML', richtext)
        self.assertIn('X-HomeEasy-Session', js)
        self.assertIn('X-HomeEasy-Meta', js)
        self.assertIn('HomeEasyCore.buildMeta', js)
        self.assertIn('RTCPeerConnection', js)
        self.assertIn('homeeasy-page-guard.js?v=3.4', html)
        self.assertRegex(html, r'id="voice-button"[^>]*disabled')
        self.assertIn('M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z', html)

    def test_frontend_defaults_to_hommy_staging_only(self):
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        index = (ROOT / 'index.html').read_text(encoding='utf-8')
        workflow = (ROOT / '.github' / 'workflows' / 'hommy-2-qa.yml').read_text(encoding='utf-8')
        self.assertIn('https://homeeasy-hommy-staging.onrender.com', js)
        self.assertIn('https://homeeasy-hommy-staging.onrender.com/api/health', index)
        self.assertIn('requestIdleCallback', index)
        self.assertIn('https://homeeasy-hommy-staging.onrender.com', workflow)
        self.assertNotIn('https://homeeasy-l5n1.onrender.com', js)
        self.assertNotIn('https://homeeasy-l5n1.onrender.com', index)
        self.assertNotIn('https://homeeasy-l5n1.onrender.com', workflow)

    def test_frontend_v2_structured_ui_contract(self):
        html = (ROOT / 'Hommychat.html').read_text(encoding='utf-8')
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        css = (ROOT / 'hommy-chat.css').read_text(encoding='utf-8')
        transport = (ROOT / 'hommy-transport.js').read_text(encoding='utf-8')
        self.assertIn('hommy-chat.js?v=2.4', html)
        self.assertIn("type === 'order'", js)
        self.assertIn("type === 'quote'", js)
        self.assertIn("type === 'customer'", js)
        self.assertIn("type === 'kpi_group'", js)
        self.assertIn("type === 'chart'", js)
        self.assertIn("documentMode !== 'explicit'", js)
        self.assertIn('navigator.share', js)
        self.assertIn('https://wa.me/', js)
        self.assertIn('createElementNS', js)
        self.assertIn("apiJSON('/api/hommy/bootstrap'", js)
        self.assertIn('suggestion-chip', css)
        self.assertIn('upstreamSignal', transport)
        self.assertIn("addEventListener?.('abort'", transport)

    def test_starter_prompts_follow_rbac_capabilities(self):
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        self.assertIn(
            "if (hasPermission('ventas.read')) rows.push(['Ventas recientes'",
            js,
        )
        self.assertIn(
            "else if (hasPermission('reportes.read')) rows.push(['Ventas de este mes'",
            js,
        )
        self.assertNotIn("hasAny('ventas.read', 'reportes.read')", js)

    def test_text_context_is_carried_into_realtime_voice(self):
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        self.assertIn('seedVoiceHistory', js)
        self.assertIn('MAX_VOICE_CONTEXT_MESSAGES', js)
        self.assertIn("type: 'conversation.item.create'", js)
        self.assertIn("'output_text'", js)
        self.assertIn("'input_text'", js)

    def test_final_voice_turns_are_deduplicated_and_synced_to_text_context(self):
        html = (ROOT / 'Hommychat.html').read_text(encoding='utf-8')
        js = (ROOT / 'hommy-chat.js').read_text(encoding='utf-8')
        self.assertIn('conversation.item.input_audio_transcription.', js)
        self.assertIn('response.output_audio_transcript.done', js)
        self.assertIn("status !== 'completed'", js)
        self.assertIn('executedCallIds', js)
        self.assertIn('finalizedTurnIds', js)
        self.assertIn("apiJSON('/api/hommy/realtime/sync'", js)
        self.assertIn('pendingCompletedResponses', js)
        self.assertIn('responseInputItems', js)
        self.assertIn('output_audio_buffer.started', js)
        self.assertIn('output_audio_buffer.stopped', js)
        self.assertIn('output_audio_buffer.cleared', js)
        self.assertIn('pendingAudioDrainResponses', js)
        self.assertIn("addEventListener('connectionstatechange'", js)
        self.assertIn('VOICE_CONNECT_TIMEOUT_MS', js)
        self.assertIn('VOICE_DISCONNECT_GRACE_MS', js)
        self.assertRegex(html, r'id="voice-help"[^>]*role="status"[^>]*aria-live="polite"')

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
