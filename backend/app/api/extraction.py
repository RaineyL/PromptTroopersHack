from fastapi import APIRouter, Depends

from app.schemas.classification import Email
from app.schemas.extraction import ExtractionCatalog as CatalogResponse, ExtractionRequest, ExtractionResponse
from app.services.extraction.catalog import ExtractionCatalog
from app.services.extraction.pipeline import extract_email
from app.services.inbox import InboxClient

router = APIRouter(prefix='/debug/extraction', tags=['extraction-debug'])


@router.get('/emails', response_model=CatalogResponse)
def list_emails(catalog: ExtractionCatalog = Depends(ExtractionCatalog)):
    return CatalogResponse(email_ids=catalog.email_ids())


@router.get('/emails/{email_id}', response_model=Email)
def get_email(email_id: str, catalog: ExtractionCatalog = Depends(ExtractionCatalog), inbox: InboxClient = Depends(InboxClient)):
    return catalog.email(email_id, inbox)


@router.post('', response_model=ExtractionResponse)
def extract(request: ExtractionRequest, catalog: ExtractionCatalog = Depends(ExtractionCatalog), inbox: InboxClient = Depends(InboxClient)):
    email = catalog.email(request.email_id, inbox)
    return extract_email(email, inbox)


pipeline_router = APIRouter(tags=['extraction'])


@pipeline_router.post('/extract', response_model=ExtractionResponse)
def extract_pipeline(request: ExtractionRequest, inbox: InboxClient = Depends(InboxClient)):
    # The pipeline UI invokes this after a confirmed BL_COMPARISON result.
    # Category ground truth is reserved for the independent Debug picker.
    email = inbox.emails(request.email_id)[0]
    return extract_email(email, inbox)
