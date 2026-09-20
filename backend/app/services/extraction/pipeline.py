"""Retrieve one email's documents and parse each side independently."""
from typing import Literal

from fastapi import HTTPException

from app.schemas.classification import Email
from app.schemas.extraction import DocumentExtraction, ExtractionResponse
from app.services.classification.engine import attachment_metadata
from app.services.inbox import InboxClient

from .documents import DocumentReadError, read_document
from .fields import document_kind, extract_fields


def extract_document(email: Email, kind: Literal['BL', 'SI'], inbox: InboxClient) -> DocumentExtraction:
    paths = [path for path, metadata in zip(email.attachments, attachment_metadata(email.attachments))
             if metadata['detected_document_type'] == kind]
    result = DocumentExtraction(document_type=kind, attachments=paths, status='needs_review')
    if len(paths) != 1:
        result.warnings = [f'Expected one {kind} attachment; found {len(paths)}. Resolve missing or multiple documents before extraction.']
        return result
    try:
        content, _ = inbox.attachment(email.email_id, paths[0])
        text = read_document(paths[0], content)
        result.source_text = text
        actual_kind = document_kind(text)
        if actual_kind != kind:
            result.warnings = [f'Attachment content was identified as {actual_kind}, not {kind}. Check the document.']
            return result
        result.fields, result.warnings = extract_fields(text)
        result.status = 'needs_review' if result.warnings else 'extracted'
    except HTTPException as exc:
        result.status = 'error'
        result.error = str(exc.detail)
    except DocumentReadError as exc:
        result.status = 'error'
        result.error = str(exc)
    return result


def extract_email(email: Email, inbox: InboxClient) -> ExtractionResponse:
    return ExtractionResponse(email=email,
                              bl=extract_document(email, 'BL', inbox),
                              si=extract_document(email, 'SI', inbox))
