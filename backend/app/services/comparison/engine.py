"""Compare a Shipping Instruction against a draft Bill of Lading.

The Shipping Instruction is the reference. Every field lands in exactly one of
three states, and the third one is the point of this module:

    match     the same value, allowing for formatting differences
    mismatch  a real discrepancy a person needs to act on
    review    the evidence does not support a confident decision either way

Forcing every near-miss into match or mismatch produces missed defects on one
side and false alarms on the other, and the brief scores escalation as its own
capability. So an email finishes as OK, MISMATCH, or NEEDS_REVIEW -- where
NEEDS_REVIEW means no comparison happened, not that a small difference was
found. Reporting 'no mismatch detected' for a document nobody could read is the
failure this guards against.
"""

from decimal import Decimal, InvalidOperation
import difflib
import re
from dataclasses import dataclass
from typing import Any, Iterable

from app.services.comparison.labels import FIELDS, read_labelled_lines
from app.services.comparison.normalize import NORMALISERS, Value

_FILENAME = re.compile(r'^(?P<email_id>.+?)_(?P<kind>SI|BL)\.[A-Za-z0-9]+$', re.IGNORECASE)

# Review reasons, most specific first. Derived from the extraction outcome, not
# from the file name -- an attachment called *_BL.txt that opens with
# 'COMMERCIAL INVOICE' is the wrong document whatever it is called.
_WRONG_DOC = re.compile(r'not a bl or si|commercial invoice|packing list|certificate of origin|proforma', re.IGNORECASE)
_UNREADABLE = re.compile(r'cannot open|could not open|text layer|image-only|corrupt|unreadable|failed to open', re.IGNORECASE)


@dataclass(slots=True)
class Policy:
    """Where the boundary between 'badly typed' and 'actually different' sits.

    Between the two thresholds the system refuses to decide and asks a person.
    Widening that band sends more work to review and resolves fewer cases
    automatically; narrowing it does the reverse.
    """

    same_above: float = 0.90
    different_below: float = 0.70
    port_same_above: float = 0.82
    weight_relative_tolerance: float = 0.0
    locode_conflict_is_review: bool = True


def _ratio(left: Any, right: Any) -> float:
    return difflib.SequenceMatcher(None, str(left), str(right)).ratio()


def _display(value: Value | None) -> str:
    """What the report shows for this value.

    For a party this is the name as it stood beside the label, not the name
    with the postal address run on after it. The address is not one of the
    seven checked fields, and showing it here makes two identical parties look
    different when the source formats punctuate the address differently.
    """
    if value is None:
        return ''
    if value.present and 'address' in value.extra and value.extra.get('name'):
        return str(value.extra['name']).strip()
    return str(value.raw).strip()


# ---------------------------------------------------------------------------
# field-level comparison
# ---------------------------------------------------------------------------

def _compare_text(field: str, si: Value, bl: Value, policy: Policy, same_above: float) -> dict[str, Any]:
    left, right = str(si.comparable), str(bl.comparable)
    if left == right:
        return _row(field, 'match', si, bl, 'Identical once formatting is normalised.', 1.0)

    score = _ratio(left, right)
    if score >= same_above:
        return _row(field, 'match', si, bl,
                    f'Differs only by characters consistent with a typing or scanning error '
                    f'(similarity {score:.2f}).', score)
    if score <= policy.different_below:
        return _row(field, 'mismatch', si, bl, f'Different value (similarity {score:.2f}).', score)
    return _row(field, 'review', si, bl,
                f'Too close to call: similarity {score:.2f} sits between a typing error and a '
                f'real difference, so this needs a person.', score)


def _compare_port(field: str, si: Value, bl: Value, policy: Policy) -> dict[str, Any]:
    row = _compare_text(field, si, bl, policy, policy.port_same_above)
    si_code, bl_code = si.extra.get('locode'), bl.extra.get('locode')

    if si_code and bl_code and si_code != bl_code and row['status'] == 'match':
        return _row(field, 'review', si, bl,
                    f'The port names agree but the UN/LOCODEs do not ({si_code} against {bl_code}), '
                    f'so the two documents contradict each other.', row['similarity'])
    if row['status'] == 'mismatch' and si_code and bl_code and si_code == bl_code:
        row['reason'] += (f' The UN/LOCODE is identical ({si_code}) — the code was left untouched '
                          f'while the port name changed.')
    return row


def _compare_number(field: str, si: Value, bl: Value, policy: Policy) -> dict[str, Any]:
    left, right = si.comparable, bl.comparable
    if left == right:
        return _row(field, 'match', si, bl, 'Equal.', 1.0)

    if field == 'gross_weight_kg' and policy.weight_relative_tolerance:
        scale = max(abs(left), abs(right)) or 1.0
        if abs(left - right) / scale <= policy.weight_relative_tolerance:
            return _row(field, 'match', si, bl, 'Within the allowed rounding tolerance.', 1.0)

    reason = f'SI {left:g} against BL {right:g}.'
    si_unit, bl_unit = si.extra.get('unit_seen'), bl.extra.get('unit_seen')
    if si_unit and bl_unit and si_unit != bl_unit:
        reason += f' The documents used different units ({si_unit} and {bl_unit}); both were converted to kilograms first.'
    return _row(field, 'mismatch', si, bl, reason, 0.0)


def _row(field: str, status: str, si: Value | None, bl: Value | None,
         reason: str, similarity: float | None = None) -> dict[str, Any]:
    return {
        'field': field,
        'status': status,
        'si_label': (si.label or None) if si else None,
        'si_value': _display(si),
        'bl_label': (bl.label or None) if bl else None,
        'bl_value': _display(bl),
        'reason': reason,
        'similarity': round(similarity, 4) if similarity is not None else None,
    }


def compare_field(field: str, si: Value | None, bl: Value | None, policy: Policy) -> dict[str, Any]:
    missing_in = [side for side, value in (('SI', si), ('BL', bl))
                  if value is None or not value.present]
    if missing_in:
        return _row(field, 'review', si, bl,
                    f'The value is blank, a placeholder, or unreadable in the '
                    f'{" and ".join(missing_in)}, so there is nothing to compare against.')
    if field in ('port_of_loading', 'port_of_discharge'):
        return _compare_port(field, si, bl, policy)
    if field in ('container_count', 'gross_weight_kg'):
        return _compare_number(field, si, bl, policy)
    return _compare_text(field, si, bl, policy, policy.same_above)


# ---------------------------------------------------------------------------
# document-level comparison
# ---------------------------------------------------------------------------

def _to_values(document: dict[str, Any], labelled: dict[str, tuple[str, str]]) -> dict[str, Value]:
    """Normalise one extracted document into comparable values."""
    fields = document.get('fields') or {}
    values: dict[str, Value] = {}

    for field in FIELDS:
        label, name_line = '', None
        if field in labelled:
            label, name_line = labelled[field]

        # What the document itself wrote beside the label wins over the
        # extracted field. An extractor that meets a blank label can run on
        # into the next line and report a neighbouring field's text as this
        # one's value; the label line is the evidence that it was blank.
        raw = name_line if name_line is not None else fields.get(field)

        if document.get('canonical') and field in ('container_count', 'gross_weight_kg'):
            try:
                number = Decimal(str(raw))
                valid = number.is_finite() and number >= 0 and (field != 'container_count' or number == number.to_integral_value())
                values[field] = Value(raw=str(raw or ''), comparable=number, present=valid)
            except InvalidOperation:
                values[field] = Value(raw=str(raw or ''), present=False)
        elif field in ('shipper', 'consignee', 'notify_party'):
            values[field] = NORMALISERS[field](raw, label, name_line)
        else:
            values[field] = NORMALISERS[field](raw, label)
    return values


def _blocking_reason(document: dict[str, Any] | None, side: str,
                     labelled: dict[str, tuple[str, str]]) -> tuple[str, str] | None:
    """Return (review_reason, explanation) if this document cannot be compared."""
    if document is None:
        return 'missing_attachment', f'The {side} attachment was not provided with this email.'

    flag = str(document.get('flag_reason') or '')
    fields = document.get('fields') or {}
    # Readable means *any* of the seven fields can be obtained, from the
    # extractor's output or from the document's own text. A document the
    # extractor gave up on is still comparable if its text can be read.
    readable = (any(fields.get(field) not in (None, '') for field in FIELDS)
                or any(value for _, value in labelled.values()))

    # Most specific first: a Commercial Invoice that opens cleanly is the wrong
    # document, not an unreadable one, and the reviewer needs to know which.
    if _WRONG_DOC.search(flag):
        return 'wrong_doc_type', f'The {side} attachment is not a Shipping Instruction or Bill of Lading. {flag}'.strip()
    if _UNREADABLE.search(flag):
        return 'unreadable', f'The {side} attachment could not be read. {flag}'.strip()
    if not readable:
        return 'unreadable', (f'No shipment fields could be read from the {side} attachment. {flag}').strip()
    return None


def compare_pair(email_id: str, si_document: dict[str, Any] | None,
                 bl_document: dict[str, Any] | None,
                 policy: Policy | None = None) -> dict[str, Any]:
    """Compare one SI against one draft BL and return the full outcome."""
    policy = policy or Policy()
    result: dict[str, Any] = {
        'email_id': email_id,
        'status': 'OK',
        'review_reason': None,
        'review_detail': None,
        'has_defect': False,
        'defect_fields': [],
        'review_fields': [],
        'si_document': (si_document or {}).get('file'),
        'bl_document': (bl_document or {}).get('file'),
        'fields': [],
    }

    # Gate: is there anything to compare at all? A document that is missing,
    # unreadable, or simply the wrong document stops the check before any field
    # is looked at -- and never reports 'no mismatch detected'.
    prepared: dict[str, dict[str, tuple[str, str]]] = {}
    for document, side in ((si_document, 'SI'), (bl_document, 'BL')):
        labelled = read_labelled_lines((document or {}).get('raw_text') or '')
        blocking = _blocking_reason(document, side, labelled)
        if blocking:
            result['status'] = 'NEEDS_REVIEW'
            result['review_reason'], result['review_detail'] = blocking
            return result
        prepared[side] = labelled

    si_values = _to_values(si_document, prepared['SI'])   # type: ignore[arg-type]
    bl_values = _to_values(bl_document, prepared['BL'])   # type: ignore[arg-type]

    for field in FIELDS:
        row = compare_field(field, si_values.get(field), bl_values.get(field), policy)
        result['fields'].append(row)
        if row['status'] == 'mismatch':
            result['defect_fields'].append(field)
        elif row['status'] == 'review':
            result['review_fields'].append(field)

    if result['defect_fields']:
        # A confirmed discrepancy is actionable even when another field is
        # unclear, so it outranks review. If any field has a defect, the email
        # is directly and completely a mismatch.
        result['status'] = 'MISMATCH'
        result['has_defect'] = True
        result['review_fields'] = []
        result['review_reason'] = None
        result['review_detail'] = None
    elif result['review_fields']:
        result['status'] = 'NEEDS_REVIEW'
        unresolved = [row for row in result['fields']
                      if row['status'] == 'review' and 'nothing to compare against' in row['reason']]
        result['review_reason'] = 'missing_value' if unresolved else 'uncertain_value'
        result['review_detail'] = ', '.join(
            f'{row["field"]}: {row["reason"]}' for row in result['fields'] if row['status'] == 'review')

    return result


def compare_documents(documents: Iterable[dict[str, Any]],
                      policy: Policy | None = None) -> dict[str, Any]:
    """Pair extracted documents by email id and compare every pair."""
    pairs: dict[str, dict[str, dict[str, Any]]] = {}
    unpaired: list[str] = []

    for document in documents:
        match = _FILENAME.match(str(document.get('file') or ''))
        if not match:
            unpaired.append(str(document.get('file') or '(unnamed)'))
            continue
        pairs.setdefault(match.group('email_id'), {})[match.group('kind').upper()] = document

    results = [compare_pair(email_id, sides.get('SI'), sides.get('BL'), policy)
               for email_id, sides in sorted(pairs.items())]

    counts = {'OK': 0, 'MISMATCH': 0, 'NEEDS_REVIEW': 0}
    for result in results:
        counts[result['status']] += 1
    defects: dict[str, int] = {}
    for result in results:
        for field in result['defect_fields']:
            defects[field] = defects.get(field, 0) + 1

    return {
        'summary': {
            'emails': len(results),
            'ok': counts['OK'],
            'mismatch': counts['MISMATCH'],
            'needs_review': counts['NEEDS_REVIEW'],
            'defect_fields': dict(sorted(defects.items(), key=lambda item: -item[1])),
            'unpaired_files': unpaired,
        },
        'results': results,
    }
