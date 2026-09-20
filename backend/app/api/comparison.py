from fastapi import APIRouter, HTTPException

from app.schemas.comparison import CompareRequest, CompareResponse, ExtractionCompareRequest
from app.schemas.extraction import ExtractionResponse
from app.services.comparison.extraction import compare_extractions
from app.services.comparison import compare_documents

router = APIRouter()


@router.post('/compare', response_model=CompareResponse)
def compare(request: ExtractionResponse | ExtractionCompareRequest | CompareRequest) -> CompareResponse:
    """Compare current extraction responses, with legacy flat records supported."""
    if isinstance(request, ExtractionResponse):
        return compare_extractions([request])
    if isinstance(request, ExtractionCompareRequest):
        return compare_extractions(request.extractions)
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
