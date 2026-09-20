"""Route one Docker attachment to its format-specific reader."""
from pathlib import PurePosixPath

from .excel import read_excel
from .limits import DocumentReadError, MAX_BYTES, MAX_TEXT
from .pdf import read_pdf
from .txt import read_txt
from .word import read_word

READERS = {'.txt': read_txt, '.pdf': read_pdf, '.docx': read_word, '.xlsx': read_excel}


def read_document(path: str, content: bytes) -> str:
    if len(content) > MAX_BYTES:
        raise DocumentReadError('Document exceeds the 10 MB limit.')
    suffix = PurePosixPath(path).suffix.lower()
    if suffix not in READERS:
        raise DocumentReadError('Unsupported document format. Use TXT, PDF, DOCX, or XLSX.')
    text = READERS[suffix](content).replace('\r\n', '\n').replace('\r', '\n').strip()
    if not text:
        raise DocumentReadError('No readable text found. Scanned documents require OCR, which is not implemented.')
    if len(text) > MAX_TEXT:
        raise DocumentReadError('Document text exceeds 100,000 characters.')
    return text
