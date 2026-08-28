import unittest

import servidor


class HommyHttpContractTests(unittest.TestCase):
    def setUp(self):
        self.client = servidor.app.test_client()

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


if __name__ == '__main__':
    unittest.main()
