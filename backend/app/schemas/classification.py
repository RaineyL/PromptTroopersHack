from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Category = Literal['BL_COMPARISON', 'SI_REQUEST', 'INVOICE_QUERY', 'GENERAL', 'SPAM']


class Email(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='forbid', str_strip_whitespace=True)
    email_id: str = Field(min_length=1, max_length=200)
    sender: str = Field(default='', alias='from', max_length=1000)
    subject: str = Field(default='', max_length=2000)
    body: str = Field(min_length=1, max_length=100000)
    attachments: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=100)


class ClassifyRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: Email


class Evidence(BaseModel):
    source: Literal['subject', 'body', 'attachment', 'rule_engine']
    signal: str


class Classification(BaseModel):
    category: Category
    needs_human_review: bool
    rationale: str
    evidence: list[Evidence]
    competing_category: Category | None = None
    ambiguity_reason: str | None = None
    question_for_user: str | None = None


class Audit(BaseModel):
    recommended_category: Category
    needs_human_review: bool
    reason: str
    question_for_user: str | None


class ClassifyResponse(BaseModel):
    email_id: str
    classification: Classification
    audit: Audit | None = None
    audit_risk_flags: list[str] = Field(default_factory=list)
    next_step: Literal['human_review', 'document_comparison_pending', 'classification_complete']
