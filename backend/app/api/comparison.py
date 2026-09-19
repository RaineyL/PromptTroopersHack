from fastapi import APIRouter, HTTPException

from app.schemas.comparison import CompareRequest, CompareResponse
from app.services.comparison import compare_documents

router = APIRouter()


@router.post('/compare', response_model=CompareResponse)
def compare(request: CompareRequest) -> CompareResponse:
    """Compare every SI against its draft BL and report the outcome per email.

    Documents are paired by the `<email_id>_SI` / `<email_id>_BL` file naming.
    An email where a document is missing, unreadable, or turns out to be a
    different document entirely is returned as NEEDS_REVIEW with the reason, and
    never as a clean result.
    """
    try:
        outcome = compare_documents(
            [document.model_dump() for document in request.documents])
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail='Extraction records could not be compared. Check that each document has a '
                   'file name of the form <email_id>_SI.<ext> or <email_id>_BL.<ext>.',
        ) from exc
    return CompareResponse.model_validate(outcome)
