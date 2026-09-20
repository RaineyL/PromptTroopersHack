"""Read PDF text layers, following ExtractFrom's per-page approach."""
from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from .limits import DocumentReadError, MAX_TEXT


def read_pdf(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
        if reader.is_encrypted or len(reader.pages) > 30:
            raise DocumentReadError('PDF is encrypted or exceeds 30 pages.')
        pages = []
        length = 0
        for page in reader.pages:
            part = (page.extract_text() or '').strip()
            length += len(part)
            if length > MAX_TEXT:
                raise DocumentReadError('Document text exceeds 100,000 characters.')
            if part:
                pages.append(part)
        return '\n'.join(pages)
    except (PyPdfError, ValueError, KeyError, EOFError) as exc:
        if isinstance(exc, DocumentReadError):
            raise
        raise DocumentReadError('PDF could not be read. Check that the file is valid.') from exc
