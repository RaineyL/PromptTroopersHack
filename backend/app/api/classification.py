from fastapi import APIRouter, HTTPException

from app.schemas.classification import ClassifyRequest, ClassifyResponse
from app.services.classification.pipeline import ConfigurationError, classify_email

router = APIRouter()


@router.post('/classify', response_model=ClassifyResponse)
def classify(request: ClassifyRequest) -> ClassifyResponse:
    try:
        return classify_email(request)
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail='Classification provider failed or returned invalid data. Retry this email.') from exc
