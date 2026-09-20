"""Limits and errors shared by the document readers."""
from io import BytesIO
from zipfile import BadZipFile, ZipFile

MAX_BYTES = 10_000_000
MAX_TEXT = 100_000


class DocumentReadError(ValueError):
    pass


def check_archive(content: bytes) -> None:
    try:
        with ZipFile(BytesIO(content)) as archive:
            members = archive.infolist()
            if len(members) > 2000 or sum(item.file_size for item in members) > 25_000_000:
                raise DocumentReadError('Document archive exceeds the expanded size limit.')
    except BadZipFile as exc:
        raise DocumentReadError('Document could not be read. Check that the file is valid.') from exc
