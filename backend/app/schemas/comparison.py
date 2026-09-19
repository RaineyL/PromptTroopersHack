from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CompareStatus = Literal['OK', 'MISMATCH', 'NEEDS_REVIEW']
FieldStatus = Literal['match', 'mismatch', 'review']
ReviewReason = Literal['missing_attachment', 'wrong_doc_type', 'unreadable',
                       'missing_value', 'uncertain_value']

CheckedField = Literal['shipper', 'consignee', 'notify_party', 'port_of_loading',
                       'port_of_discharge', 'container_count', 'gross_weight_kg']


class ExtractedDocument(BaseModel):
    """One SI or BL as the extraction stage produced it.

    `file` carries the pairing: `<email_id>_SI.<ext>` and `<email_id>_BL.<ext>`.
    `raw_text` is optional but strongly preferred — it is what lets the report
    show the label each document actually used, and what separates a party name
    from the postal address underneath it.
    """

    model_config = ConfigDict(extra='ignore', str_strip_whitespace=True)

    file: str = Field(min_length=1, max_length=400)
    status: str = Field(default='ok', max_length=100)
    flag_reason: str | None = Field(default=None, max_length=4000)
    fields: dict[str, Any] = Field(default_factory=dict)
    raw_text: str = Field(default='', max_length=200000)


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')

    documents: list[ExtractedDocument] = Field(min_length=1, max_length=1200)


class FieldComparison(BaseModel):
    field: CheckedField
    status: FieldStatus
    si_label: str | None = None
    si_value: str = ''
    bl_label: str | None = None
    bl_value: str = ''
    reason: str = ''
    similarity: float | None = None


class ComparisonResult(BaseModel):
    email_id: str
    status: CompareStatus
    review_reason: ReviewReason | None = None
    review_detail: str | None = None
    has_defect: bool = False
    defect_fields: list[CheckedField] = Field(default_factory=list)
    review_fields: list[CheckedField] = Field(default_factory=list)
    si_document: str | None = None
    bl_document: str | None = None
    fields: list[FieldComparison] = Field(default_factory=list)


class ComparisonSummary(BaseModel):
    emails: int
    ok: int
    mismatch: int
    needs_review: int
    defect_fields: dict[str, int] = Field(default_factory=dict)
    unpaired_files: list[Annotated[str, Field(max_length=400)]] = Field(default_factory=list)


class CompareResponse(BaseModel):
    summary: ComparisonSummary
    results: list[ComparisonResult]
