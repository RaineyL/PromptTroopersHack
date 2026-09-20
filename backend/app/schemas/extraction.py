from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.classification import Email


class ExtractionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email_id: str = Field(min_length=1, max_length=200, pattern=r'^[A-Za-z0-9_-]+$')


class ExtractionCatalog(BaseModel):
    email_ids: list[str]


class ExtractedField(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    value: str | None = Field(max_length=4000)
    evidence: str | None = Field(max_length=8000)


class ShipmentFields(BaseModel):
    model_config = ConfigDict(extra='forbid')
    shipper: ExtractedField
    consignee: ExtractedField
    notify_party: ExtractedField
    port_of_loading: ExtractedField
    port_of_discharge: ExtractedField
    container_count: ExtractedField
    gross_weight_kg: ExtractedField


class DocumentExtraction(BaseModel):
    document_type: Literal['BL', 'SI']
    attachments: list[str]
    status: Literal['extracted', 'needs_review', 'error']
    fields: ShipmentFields | None = None
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    source_text: str | None = None


class ExtractionResponse(BaseModel):
    email: Email
    bl: DocumentExtraction
    si: DocumentExtraction
