"""Compare the extraction API's values without parsing the documents again."""
from app.schemas.extraction import ExtractionResponse
from app.schemas.comparison import CompareResponse
from app.services.comparison.engine import compare_pair
from app.services.comparison.labels import read_labelled_lines


def _party_name_lines(document) -> dict[str, tuple[str, str]]:
    if document.fields is None:
        return {}
    names = {}
    for key in ('shipper', 'consignee', 'notify_party'):
        field = getattr(document.fields, key)
        if field.value is not None and field.evidence:
            labelled = read_labelled_lines(field.evidence)
            if key in labelled:
                names[key] = labelled[key]
    return names


def compare_extractions(extractions: list[ExtractionResponse]) -> CompareResponse:
    results = []
    for extraction in extractions:
        documents = {}
        blockers = []
        for side in ('si', 'bl'):
            document = getattr(extraction, side)
            reason = None
            if document.document_type != side.upper():
                reason = 'wrong_doc_type'
            elif len(document.attachments) != 1:
                reason = 'missing_attachment' if not document.attachments else 'uncertain_value'
            elif document.status == 'error':
                reason = 'unreadable'
            elif document.status != 'extracted' or document.warnings or document.error or document.fields is None:
                reason = 'uncertain_value'
            if reason:
                detail = '; '.join(document.warnings + ([document.error] if document.error else []))
                blockers.append((reason, f'{side.upper()}: {detail or "Please check this document before comparing it."}'))
            documents[side] = {
                'file': document.attachments[0] if len(document.attachments) == 1 else None,
                'fields': {key: field.value for key, field in document.fields} if document.fields else {},
                'party_name_lines': _party_name_lines(document),
                # Canonical extraction values already carry normalised units.
                'canonical': True,
            }
        result = compare_pair(extraction.email.email_id, documents['si'], documents['bl'])
        if blockers and not result.get('defect_fields'):
            result.update(status='NEEDS_REVIEW', review_reason=blockers[0][0],
                          review_detail='; '.join(detail for _, detail in blockers),
                          fields=[], defect_fields=[], review_fields=[], has_defect=False)
        results.append(result)
    defects: dict[str, int] = {}
    for result in results:
        for field in result['defect_fields']:
            defects[field] = defects.get(field, 0) + 1
    return CompareResponse.model_validate({
        'summary': {'emails': len(results), 'ok': sum(r['status'] == 'OK' for r in results),
                    'mismatch': sum(r['status'] == 'MISMATCH' for r in results),
                    'needs_review': sum(r['status'] == 'NEEDS_REVIEW' for r in results),
                    'defect_fields': defects, 'unpaired_files': []},
        'results': results,
    })
