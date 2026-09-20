from fastapi import APIRouter, Header, HTTPException

from app.schemas.classification import ClassifyRequest, ClassifyResponse
from app.services.classification.pipeline import ConfigurationError, classify_email
from app.services.uploaded_inbox import get_uploaded_inbox

router = APIRouter()


@router.post('/classify', response_model=ClassifyResponse)
def classify(request: ClassifyRequest, x_inbox_session: str | None = Header(default=None)) -> ClassifyResponse:
    if x_inbox_session:
        # Keep long uploads active as each email passes through the provider.
        get_uploaded_inbox(x_inbox_session).emails(request.email.email_id)
    try:
        return classify_email(request)
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail='Classification provider failed or returned invalid data. Retry this email.') from exc
