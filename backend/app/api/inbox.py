from fastapi import APIRouter, Depends, Response

from app.schemas.classification import Email
from app.services.inbox import InboxClient

router = APIRouter(prefix='/inbox', tags=['inbox'])


@router.get('/emails', response_model=list[Email])
def list_emails(client: InboxClient = Depends(InboxClient)):
    return client.emails()


@router.get('/emails/{email_id}', response_model=Email)
def get_email(email_id: str, client: InboxClient = Depends(InboxClient)):
    return client.emails(email_id)[0]


@router.get('/emails/{email_id}/attachments/{path:path}')
def get_attachment(email_id: str, path: str, client: InboxClient = Depends(InboxClient)):
    content, media_type = client.attachment(email_id, path)
    return Response(content, media_type=media_type, headers={
        'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff',
    })
