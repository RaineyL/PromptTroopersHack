"""Read DOCX body blocks in order, then headers and footers."""
from io import BytesIO

from docx import Document
from docx.opc.exceptions import PackageNotFoundError
from docx.table import Table
from lxml.etree import XMLSyntaxError

from .limits import DocumentReadError, check_archive
from .tabular import format_cells


def read_word(content: bytes) -> str:
    check_archive(content)
    try:
        document = Document(BytesIO(content))
        lines = []
        for block in document.iter_inner_content():
            if isinstance(block, Table):
                for row in block.rows:
                    line = format_cells([cell.text for cell in row.cells])
                    if line:
                        lines.append(line)
            elif block.text.strip():
                lines.append(block.text.strip())
        for section in document.sections:
            for part in (section.header, section.footer):
                lines.extend(paragraph.text.strip() for paragraph in part.paragraphs if paragraph.text.strip())
        return '\n'.join(lines)
    except (PackageNotFoundError, XMLSyntaxError, KeyError, ValueError, OSError) as exc:
        raise DocumentReadError('Word document could not be read. Check that the file is valid.') from exc
