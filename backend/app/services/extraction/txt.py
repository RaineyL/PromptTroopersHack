"""Decode plain-text attachments with the encodings used by ExtractFrom."""
from .limits import DocumentReadError


def read_txt(content: bytes) -> str:
    for encoding in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DocumentReadError('Text attachment could not be decoded.')
