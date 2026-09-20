import io
import json
import unittest
import zipfile

from fastapi.testclient import TestClient

from app.main import app


def bundle(files):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return data.getvalue()


class UploadedInboxTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.email = {'email_id': 'email_001', 'body': 'Compare the two attached documents.',
                      'attachments': ['attachments/a_SI.txt', 'attachments/a_BL.txt']}
        self.files = {'bundle/inbox/email_001.json': json.dumps(self.email),
                      'bundle/attachments/a_SI.txt': 'SHIPPING INSTRUCTION\nShipper: Example',
                      'bundle/attachments/a_BL.txt': 'BILL OF LADING\nShipper: Example'}

    def test_upload_scopes_attachment_and_extraction_to_session(self):
        response = self.client.post('/api/v1/inbox/upload', content=bundle(self.files), headers={'Content-Type': 'application/zip'})
        self.assertEqual(response.status_code, 200, response.text)
        token = response.json()['session_id']
        headers = {'X-Inbox-Session': token}
        self.assertEqual(len(response.json()['emails']), 1)
        self.assertEqual(self.client.get('/api/v1/inbox/emails', headers=headers).json()[0]['email_id'], 'email_001')
        self.assertIn(b'SHIPPING INSTRUCTION', self.client.get('/api/v1/inbox/emails/email_001/attachments/attachments/a_SI.txt', headers=headers).content)
        self.assertEqual(self.client.get('/api/v1/inbox/emails/email_001/attachments/attachments/a_BL.txt', headers={'X-Inbox-Session': 'unknown'}).status_code, 404)
        self.assertEqual(self.client.post('/api/v1/classify', json={'email': self.email}, headers={'X-Inbox-Session': 'unknown'}).status_code, 404)
        result = self.client.post('/api/v1/extract', json={'email_id': 'email_001'}, headers=headers)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['email']['email_id'], 'email_001')

    def test_rejects_missing_referenced_file_and_unsafe_archive(self):
        missing = {name: content for name, content in self.files.items() if not name.endswith('a_BL.txt')}
        for files in (missing, {**self.files, '../inbox/evil.json': '{}'},
                      {**self.files, 'bundle/inbox/email_002.json': json.dumps(self.email)}):
            with self.subTest(files=list(files)):
                response = self.client.post('/api/v1/inbox/upload', content=bundle(files), headers={'Content-Type': 'application/zip'})
                self.assertEqual(response.status_code, 422, response.text)

    def test_rejects_non_zip_and_oversized_request(self):
        self.assertEqual(self.client.post('/api/v1/inbox/upload', content=b'bad', headers={'Content-Type': 'application/zip'}).status_code, 422)
        self.assertEqual(self.client.post('/api/v1/inbox/upload', content=bundle(self.files), headers={'Content-Type': 'application/json'}).status_code, 415)

    def test_finder_metadata_does_not_count_as_source_files(self):
        files = {**self.files, **{f'__MACOSX/attachments/._extra_{index}.txt': 'metadata' for index in range(1501)}}
        response = self.client.post('/api/v1/inbox/upload', content=bundle(files), headers={'Content-Type': 'application/zip'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['emails']), 1)

    def test_processes_more_than_520_emails_and_1500_source_files(self):
        files = {f'inbox/email_{index:04d}.json': json.dumps({'email_id': f'email_{index:04d}', 'body': 'Please review.'})
                 for index in range(1601)}
        response = self.client.post('/api/v1/inbox/upload', content=bundle(files), headers={'Content-Type': 'application/zip'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['emails']), 1601)
