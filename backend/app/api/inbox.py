from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from app.schemas.classification import Email
from app.services.inbox import InboxClient
from app.services.uploaded_inbox import MAX_ARCHIVE, get_uploaded_inbox, save_archive
from app.services.uploaded_inbox import UploadedInbox

router = APIRouter(prefix='/inbox', tags=['inbox'])


def inbox_source(x_inbox_session: str | None = Header(default=None), client: InboxClient = Depends(InboxClient)) -> InboxClient | UploadedInbox:
    return get_uploaded_inbox(x_inbox_session) or client


@router.post('/upload')
async def upload_inbox(request: Request, x_inbox_session: str | None = Header(default=None)):
    if request.headers.get('content-type', '').split(';')[0] not in ('application/zip', 'application/x-zip-compressed'):
        raise HTTPException(415, 'Upload a ZIP file with Content-Type: application/zip.')
    parts = []
    size = 0
    async for part in request.stream():
        size += len(part)
        if size > MAX_ARCHIVE:
            raise HTTPException(413, 'ZIP must be at most 50 MB.')
        parts.append(part)
    token, inbox = save_archive(b''.join(parts), x_inbox_session)
    return {'session_id': token, 'emails': [email.model_dump(by_alias=True) for email in inbox.emails()]}


@router.get('/emails', response_model=list[Email])
def list_emails(client: InboxClient = Depends(inbox_source)):
    return client.emails()


@router.get('/emails/{email_id}', response_model=Email)
def get_email(email_id: str, client: InboxClient = Depends(inbox_source)):
    return client.emails(email_id)[0]


@router.get('/emails/{email_id}/attachments/{path:path}')
def get_attachment(email_id: str, path: str, client: InboxClient = Depends(inbox_source)):
    content, media_type = client.attachment(email_id, path)
    return Response(content, media_type=media_type, headers={
        'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff',
    })
