"""Bounded, temporary ZIP inboxes for a single browser pipeline session."""
import io
import json
import mimetypes
import threading
import time
import uuid
import zipfile
from pathlib import PurePosixPath

from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError

from app.schemas.classification import Email

MAX_ARCHIVE = 50_000_000
MAX_UNPACKED = 100_000_000
_TTL = 4 * 60 * 60
_sessions: dict[str, tuple[float, 'UploadedInbox']] = {}
_lock = threading.Lock()


class UploadedInbox:
    def __init__(self, emails: list[Email], files: dict[str, bytes]):
        self.records = {email.email_id: email for email in emails}
        self.files = files

    def emails(self, email_id: str | None = None) -> list[Email]:
        if email_id is None:
            return list(self.records.values())
        if email_id not in self.records:
            raise HTTPException(404, 'Email not found in uploaded inbox.')
        return [self.records[email_id]]

    def attachment(self, email_id: str, path: str) -> tuple[bytes, str]:
        email = self.emails(email_id)[0]
        if path not in email.attachments or path not in self.files:
            raise HTTPException(404, 'Attachment not found for this email.')
        return self.files[path], mimetypes.guess_type(path)[0] or 'application/octet-stream'


def parse_archive(data: bytes) -> UploadedInbox:
    if len(data) > MAX_ARCHIVE:
        raise HTTPException(413, 'ZIP must be at most 50 MB.')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = [entry for entry in archive.infolist() if not entry.is_dir()]
            files: dict[str, bytes] = {}
            selected_size = 0
            for entry in entries:
                parts = PurePosixPath(entry.filename).parts
                if (not parts or any(part in ('..', '.') for part in parts) or
                    entry.filename.startswith('/') or '\\' in entry.filename or
                    any(ord(char) < 32 for char in entry.filename) or
                    (entry.external_attr >> 16) & 0o170000 == 0o120000):
                    raise HTTPException(422, 'ZIP contains an unsafe file path or link.')
                # Finder adds AppleDouble copies of every file; they are not source documents.
                if parts[0] == '__MACOSX' or parts[-1].startswith('._') or parts[-1] == '.DS_Store':
                    continue
                # Accept a ZIP with one enclosing folder, as well as inbox/ at its root.
                offset = 1 if len(parts) > 1 and parts[0] not in ('inbox', 'attachments') else 0
                relative = '/'.join(parts[offset:])
                if relative.startswith(('inbox/', 'attachments/')):
                    selected_size += entry.file_size
                    if selected_size > MAX_UNPACKED:
                        raise HTTPException(413, 'ZIP exceeds 100 MB of uncompressed inbox/attachment data.')
                    if relative in files:
                        raise HTTPException(422, 'ZIP contains duplicate file paths.')
                    files[relative] = archive.read(entry)
            names = sorted(name for name in files if name.startswith('inbox/') and name.endswith('.json') and name.count('/') == 1)
            if not names:
                raise HTTPException(422, 'ZIP must contain at least one inbox/*.json email record.')
            emails = [TypeAdapter(Email).validate_python(json.loads(files[name])) for name in names]
            ids = [email.email_id for email in emails]
            if len(set(ids)) != len(ids):
                raise HTTPException(422, 'ZIP contains duplicate email IDs.')
            for name, email in zip(names, emails):
                if name != f'inbox/{email.email_id}.json':
                    raise HTTPException(422, 'Inbox filename must match its email_id.')
                for path in email.attachments:
                    if not path.startswith('attachments/') or path not in files:
                        raise HTTPException(422, f'{email.email_id} references a missing attachment.')
            return UploadedInbox(emails, {name: content for name, content in files.items() if name.startswith('attachments/')})
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, NotImplementedError,
            UnicodeError, json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(422, 'Invalid ZIP or email JSON. Include inbox/ and attachments/ directories.') from exc


def save_archive(data: bytes, replace_token: str | None = None) -> tuple[str, UploadedInbox]:
    inbox = parse_archive(data)
    token = uuid.uuid4().hex
    with _lock:
        now = time.monotonic()
        for key, (created, _) in list(_sessions.items()):
            if now - created > _TTL:
                del _sessions[key]
        if replace_token:
            _sessions.pop(replace_token, None)
        if len(_sessions) >= 4:
            raise HTTPException(503, 'Too many active ZIP sessions. Try again later.')
        _sessions[token] = (now, inbox)
    return token, inbox


def get_uploaded_inbox(token: str | None) -> UploadedInbox | None:
    if token is None:
        return None
    with _lock:
        found = _sessions.get(token)
        if found and time.monotonic() - found[0] <= _TTL:
            _sessions[token] = (time.monotonic(), found[1])
            return found[1]
        _sessions.pop(token, None)
    raise HTTPException(404, 'Uploaded ZIP session expired. Upload it again.')
