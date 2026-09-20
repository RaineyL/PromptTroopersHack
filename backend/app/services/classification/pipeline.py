"""POC review-gate-v1, shared by the HTTP boundary and offline tests."""

import os
from typing import Protocol

from app.schemas.classification import ClassifyRequest, ClassifyResponse
from .engine import (
    DEFAULT_PROMPT, DEFAULT_AUDIT_PROMPT, DeepSeekClient, build_user_message,
    build_audit_message, detect_review_risks,
    validate_classification, validate_audit,
)


class ModelClient(Protocol):
    def classify(self, system_prompt: str, user_message: str) -> dict: ...
    def audit(self, system_prompt: str, user_message: str) -> dict: ...


class ConfigurationError(Exception):
    pass


def get_model_client() -> ModelClient:
    key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    if not key:
        raise ConfigurationError('Set DEEPSEEK_API_KEY on the backend to use DeepSeek classification.')
    return DeepSeekClient(key, os.environ.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
                          os.environ.get('DEEPSEEK_MODEL', 'deepseek-flash'))


def classify_email(request: ClassifyRequest, client: ModelClient | None = None) -> ClassifyResponse:
    email = request.email.model_dump(by_alias=True)
    client = client or get_model_client()
    result = validate_classification(client.classify(DEFAULT_PROMPT.read_text(), build_user_message(email)))
    audit = None
    risks = detect_review_risks(email)
    if result['needs_human_review']:
        risks.append('initial_model_requested_review')
    if risks:
        audit = validate_audit(client.audit(DEFAULT_AUDIT_PROMPT.read_text(), build_audit_message(email, result, risks)))
        disagreement = audit['recommended_category'] != result['category']
        if disagreement:
            result['competing_category'] = audit['recommended_category']
        if result['needs_human_review'] or audit['needs_human_review'] or disagreement:
            result.update(needs_human_review=True, ambiguity_reason=audit['reason'],
                          question_for_user=audit['question_for_user'] or
                          f"Please confirm the category: {result['category']} (audit: {audit['recommended_category']}).")
    return ClassifyResponse(email_id=email['email_id'], classification=result,
                            audit=audit,
                            audit_risk_flags=sorted(set(risks)))
