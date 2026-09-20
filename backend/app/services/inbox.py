"""Read only the public Docker inbox endpoints, with bounded responses."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError

from app.schemas.classification import Email


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def safe_path(value: str) -> str:
    if not value or '\\' in value or any(part in ('', '.', '..') for part in value.split('/')) or any(ord(c) < 32 for c in value):
        raise HTTPException(422, 'Invalid inbox resource path.')
    return quote(value, safe='/')


class InboxClient:
    def __init__(self):
        self.base_url = os.environ.get('INBOX_BASE_URL', 'http://127.0.0.1:8080').rstrip('/')
        parsed = urlsplit(self.base_url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise HTTPException(503, 'Configure INBOX_BASE_URL with the Docker inbox HTTP origin.')

    def read(self, path: str) -> tuple[bytes, str]:
        try:
            with build_opener(NoRedirects()).open(Request(self.base_url + path), timeout=20) as response:
                data = response.read(10_000_001)
                if len(data) > 10_000_000:
                    raise HTTPException(502, 'Docker inbox response exceeds 10 MB.')
                return data, response.headers.get_content_type()
        except HTTPError as exc:
            if exc.code == 404:
                raise HTTPException(404, 'Email or attachment not found in Docker inbox.') from exc
            raise HTTPException(502, 'Docker inbox returned an error. Retry the request.') from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise HTTPException(502, 'Cannot reach Docker inbox. Start docker compose up --build and check INBOX_BASE_URL.') from exc

    def emails(self, email_id: str | None = None) -> list[Email]:
        path = '/emails' if email_id is None else '/emails/' + safe_path(email_id)
        data, _ = self.read(path)
        try:
            decoded = json.loads(data)
            emails = TypeAdapter(list[Email]).validate_python(decoded if email_id is None else [decoded])
            if len({email.email_id for email in emails}) != len(emails):
                raise ValueError('Duplicate email IDs')
            if email_id is not None and (len(emails) != 1 or emails[0].email_id != email_id):
                raise ValueError('Unexpected email ID')
            return emails
        except (ValueError, ValidationError) as exc:
            raise HTTPException(502, 'Docker inbox returned invalid email records.') from exc

    def attachment(self, email_id: str, path: str) -> tuple[bytes, str]:
        safe_path(path)
        email = self.emails(email_id)[0]
        if path not in email.attachments:
            raise HTTPException(404, 'Attachment does not belong to this email.')
        # Dataset references include attachments/, while the endpoint is relative to that directory.
        return self.read('/attachments/' + safe_path(path.removeprefix('attachments/')))
