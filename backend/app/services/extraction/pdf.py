"""Read PDF text layers and OCR pages without usable text."""
from io import BytesIO
import subprocess

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from .limits import DocumentReadError, MAX_TEXT

OCR_TIMEOUT_SECONDS = 30
MIN_PAGE_TEXT_LENGTH = 10


def ocr_page(content: bytes, page_number: int) -> str:
    """Render one page at 300 DPI and pass the PNG to Tesseract."""
    try:
        rendered = subprocess.run(
            ['pdftoppm', '-f', str(page_number), '-l', str(page_number),
             '-r', '300', '-singlefile', '-png', '-'],
            input=content, capture_output=True, check=True,
            timeout=OCR_TIMEOUT_SECONDS,
        )
        recognized = subprocess.run(
            ['tesseract', 'stdin', 'stdout', '-l', 'eng'],
            input=rendered.stdout, capture_output=True, check=True,
            timeout=OCR_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise DocumentReadError(
            f'OCR requires {exc.filename}. Install Poppler and Tesseract to read scanned PDFs.'
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise DocumentReadError(f'OCR timed out on PDF page {page_number}.') from exc
    except subprocess.CalledProcessError as exc:
        raise DocumentReadError(f'OCR failed on PDF page {page_number}.') from exc
    return recognized.stdout.decode('utf-8', errors='replace').strip()


def read_pdf(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
        if reader.is_encrypted or len(reader.pages) > 30:
            raise DocumentReadError('PDF is encrypted or exceeds 30 pages.')
        pages = []
        length = 0
        for page_number, page in enumerate(reader.pages, start=1):
            part = (page.extract_text() or '').strip()
            if len(part) < MIN_PAGE_TEXT_LENGTH:
                ocr_text = ocr_page(content, page_number)
                if len(ocr_text) > len(part):
                    part = ocr_text
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
