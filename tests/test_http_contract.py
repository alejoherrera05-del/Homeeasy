import os
import unittest
from unittest.mock import Mock, patch

import servidor
from hommy_backend.auth import AuthContext
from hommy_backend.continuity import RealtimeSyncUnavailable


class HommyHttpContractTests(unittest.TestCase):
    def setUp(self):
        self.client = servidor.app.test_client()
        servidor.rate_limiter.clear()

    def test_health_reports_hommy_2(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['service'], 'Hommy')
        self.assertTrue(str(payload['version']).startswith('2.'))

    def test_chat_requires_homeeasy_session(self):
        response = self.client.post('/api/hommy/chat', json={'message': 'hola'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error']['code'], 'AUTH_REQUIRED')

    def test_authenticated_chat_is_rate_limited_per_salted_uid(self):
        context = AuthContext('rate-user', 'Usuario', 'rate@example.com', 'ASESOR', frozenset({'app.access'}))
        engine = Mock()
        engine.chat.return_value = {'answer': 'ok', 'conversationToken': 'signed', 'cards': [], 'suggestions': []}
        engine.consume_internal_metrics.return_value = {}
        with patch.dict(os.environ, {'HOMMY_RATE_CHAT_PER_MINUTE': '1'}, clear=False), patch.object(
            servidor, 'auth_context', return_value=context
        ), patch.object(servidor, 'get_engine', return_value=engine):
            first = self.client.post('/api/hommy/chat', json={'message': 'hola'})
            second = self.client.post('/api/hommy/chat', json={'message': 'otra vez'})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.get_json()['error']['code'], 'RATE_LIMITED')
        self.assertGreaterEqual(int(second.headers['Retry-After']), 1)

    def test_bootstrap_requires_session_and_returns_metadata_only(self):
        unauthorized = self.client.post('/api/hommy/bootstrap', json={})
        self.assertEqual(unauthorized.status_code, 401)

        metadata = {
            'ready': True,
            'dataUpdatedAt': '2026-08-28T12:00:00-05:00',
            'stale': False,
            'ageSeconds': 1.2,
            'refreshing': False,
        }
        with patch.object(servidor, 'auth_context', return_value=object()), patch.object(
            servidor.data_store, 'bootstrap', return_value=metadata
        ):
            response = self.client.post('/api/hommy/bootstrap', json={})
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload, {'ok': True, **metadata})
        serialized = str(payload).lower()
        for forbidden in ('cliente', 'cedula', 'ordenes', 'cotizaciones', 'total_cop'):
            self.assertNotIn(forbidden, serialized)

    def test_realtime_sync_requires_session_and_returns_only_sync_metadata(self):
        unauthorized = self.client.post('/api/hommy/realtime/sync', json={
            'turns': [{'id': 'item_1', 'role': 'user', 'text': 'hola'}],
        })
        self.assertEqual(unauthorized.status_code, 401)

        context = object()
        sync = Mock()
        sync.sync.return_value = {'conversationToken': 'signed-token', 'synced': 1}
        with patch.object(servidor, 'auth_context', return_value=context), patch.object(
            servidor, 'get_realtime_sync', return_value=sync
        ):
            response = self.client.post('/api/hommy/realtime/sync', json={
                'conversationToken': 'previous-token',
                'turns': [{'id': 'item_1', 'role': 'user', 'text': 'hola'}],
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'ok': True,
            'conversationToken': 'signed-token',
            'synced': 1,
        })
        sync.sync.assert_called_once_with(
            context,
            'previous-token',
            [{'id': 'item_1', 'role': 'user', 'text': 'hola'}],
        )

    def test_realtime_sync_transient_upstream_failure_is_retryable(self):
        sync = Mock()
        sync.sync.side_effect = RealtimeSyncUnavailable('No fue posible conservar la continuidad de la conversación por voz.')
        with patch.object(servidor, 'auth_context', return_value=object()), patch.object(
            servidor, 'get_realtime_sync', return_value=sync
        ):
            response = self.client.post('/api/hommy/realtime/sync', json={
                'turns': [{'id': 'item_1', 'role': 'user', 'text': 'hola'}],
            })
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error']['code'], 'VOICE_SYNC_UNAVAILABLE')
        self.assertEqual(response.headers.get('Retry-After'), '1')

    def test_legacy_chat_is_disabled(self):
        response = self.client.post('/api/chat', json={'pregunta': 'hola'})
        self.assertEqual(response.status_code, 426)
        self.assertEqual(response.get_json()['error']['code'], 'CLIENT_UPGRADE_REQUIRED')

    def test_preflight_is_explicit_and_restricted(self):
        allowed = self.client.open(
            '/api/hommy/chat',
            method='OPTIONS',
            headers={
                'Origin': 'https://alejoherrera05-del.github.io',
                'Access-Control-Request-Method': 'POST',
            },
        )
        self.assertEqual(allowed.status_code, 204)
        self.assertEqual(
            allowed.headers.get('Access-Control-Allow-Origin'),
            'https://alejoherrera05-del.github.io',
        )
        self.assertIsNone(allowed.headers.get('Access-Control-Allow-Credentials'))
        self.assertEqual(allowed.headers.get('X-Content-Type-Options'), 'nosniff')

        blocked = self.client.open(
            '/api/hommy/chat',
            method='OPTIONS',
            headers={
                'Origin': 'https://example.invalid',
                'Access-Control-Request-Method': 'POST',
            },
        )
        self.assertEqual(blocked.status_code, 204)
        self.assertIsNone(blocked.headers.get('Access-Control-Allow-Origin'))
        self.assertIsNone(blocked.headers.get('Access-Control-Allow-Credentials'))


if __name__ == '__main__':
    unittest.main()
