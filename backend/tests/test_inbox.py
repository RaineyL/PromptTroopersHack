import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.services.inbox import InboxClient, safe_path

EMAIL = {'email_id': 'email_001', 'body': 'Compare attached documents.', 'attachments': ['attachments/docs/SI.txt']}


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch.object(InboxClient, 'read')
    def test_list_and_email(self, read):
        read.return_value = (json.dumps([EMAIL]).encode(), 'application/json')
        response = self.client.get('/api/v1/inbox/emails')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]['email_id'], EMAIL['email_id'])
        read.assert_called_with('/emails')
        read.return_value = (json.dumps(EMAIL).encode(), 'application/json')
        self.assertEqual(self.client.get('/api/v1/inbox/emails/email_001').status_code, 200)
        read.assert_called_with('/emails/email_001')

    @patch.object(InboxClient, 'read')
    def test_attachment_and_membership(self, read):
        read.side_effect = [(json.dumps(EMAIL).encode(), 'application/json'), (b'Original SI bytes', 'text/plain')]
        response = self.client.get('/api/v1/inbox/emails/email_001/attachments/attachments/docs/SI.txt')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'Original SI bytes')
        self.assertEqual(response.headers['content-disposition'], 'attachment')
        read.assert_called_with('/attachments/docs/SI.txt')
        read.side_effect = None
        read.return_value = (json.dumps(EMAIL).encode(), 'application/json')
        self.assertEqual(self.client.get('/api/v1/inbox/emails/email_001/attachments/unknown.txt').status_code, 404)

    @patch.object(InboxClient, 'read')
    def test_invalid_empty_and_unavailable(self, read):
        read.return_value = (b'[]', 'application/json')
        self.assertEqual(self.client.get('/api/v1/inbox/emails').json(), [])
        read.return_value = (b'{"private": "unexpected"}', 'application/json')
        self.assertEqual(self.client.get('/api/v1/inbox/emails').status_code, 502)
        read.side_effect = HTTPException(502, 'Cannot reach Docker inbox.')
        self.assertEqual(self.client.get('/api/v1/inbox/emails').status_code, 502)

    def test_path_validation(self):
        for path in ['../secret', '/absolute', 'docs/../../secret', 'docs\\secret', 'docs//SI.txt']:
            with self.subTest(path=path), self.assertRaises(HTTPException):
                safe_path(path)
        self.assertEqual(safe_path('docs/SI copy.txt'), 'docs/SI%20copy.txt')

    @patch('app.services.inbox.build_opener')
    def test_connection_failure(self, opener):
        from urllib.error import URLError
        opener.return_value.open.side_effect = URLError('connection refused')
        response = self.client.get('/api/v1/inbox/emails')
        self.assertEqual(response.status_code, 502)
        self.assertIn('docker compose', response.json()['detail'])
