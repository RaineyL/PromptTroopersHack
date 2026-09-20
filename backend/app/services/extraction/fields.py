"""Shared seven-field parser adapted from ExtractFrom's label and normalization logic."""
from decimal import Decimal, InvalidOperation
import re

from app.schemas.extraction import ExtractedField, ShipmentFields

FIELD_NAMES = tuple(ShipmentFields.model_fields)

# Aliases are kept in one place for TXT, PDF, DOCX, and XLSX alike.
ALIASES = {
    'shipper': ('shipper', 'shipper/exporter', 'shipper (principal or seller)', 'exporter', 'shipped by'),
    'consignee': ('consignee', 'consignee (non-negotiable)', 'to order of', 'to the order of'),
    'notify_party': ('notify party', 'notify', 'notify party/intermediate consignee', 'also notify'),
    'port_of_loading': ('port of loading', 'port of loading (pol)', 'load port', 'pol', 'loading port'),
    'port_of_discharge': ('port of discharge', 'port of discharge (pod)', 'discharge port', 'pod', 'discharging port', 'destination port'),
    'container_count': ('container count', 'total containers', 'no. of containers or packages', 'no. of containers', 'number of containers', 'qty/type of container', 'containers', 'container'),
    'gross_weight_kg': ('gross weight', 'gross wt (kgs)', 'gross wt', 'gross weight (kg)', 'gross weight (kgs)', 'total gross weight (kg)', 'total gross weight', 'gross wt.', 'gross weight in kgs'),
}
LABELS = {alias: field for field, aliases in ALIASES.items() for alias in aliases}
INLINE_ALIASES = sorted(LABELS, key=len, reverse=True)
PLACEHOLDER = re.compile(r'^(?:[_-]{2,}|[_\-\s]*(?:MT|MTS|KG|KGS|TONS?)|N/?A|TBA|TBC|TBD|\?+(?:\s*(?:MT|MTS|KG|KGS))?)$', re.IGNORECASE)
CONTAINER = re.compile(r'\b(\d+)\s*(?:x|×)\s*(?:\d{1,2}\s*[\'′]?\s*(?:HC|GP|FCL|DC)|[A-Z][A-Z0-9\']*)\b', re.IGNORECASE)
NUMBER = re.compile(r'(?<!\w)(\d[\d,]*(?:\.\d+)?)\b')
PORT_STOP = re.compile(r'\s*(?:Vessel(?:\s+Name)?|Ocean\s+Vessel|Export\s+Carrier|CONTAINER\s+NO\.?|V\.\d+).*', re.IGNORECASE)
DOCUMENT_TITLES = {
    'BL': re.compile(r'\b(?:bill\s+of\s+lading|draft\s+b/?l)\b', re.IGNORECASE),
    'SI': re.compile(r'\bshipping\s+instruction(?:s)?\b', re.IGNORECASE),
}
WRONG_TITLES = re.compile(r'\b(?:commercial\s+invoice|packing\s+list|certificate\s+of\s+origin|purchase\s+order)\b', re.IGNORECASE)


def document_kind(text: str) -> str:
    lead = '\n'.join(text.splitlines()[:6])
    if WRONG_TITLES.search(lead):
        return 'OTHER'
    if re.search(r'\b(?:bl|b/l|bill\s+of\s+lading)\s+instruction\b', lead, re.IGNORECASE):
        return 'SI'
    matches = [kind for kind, pattern in DOCUMENT_TITLES.items() if pattern.search(lead)]
    return matches[0] if len(matches) == 1 else 'UNKNOWN'


def _label_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if ':' in stripped:
        label, value = stripped.split(':', 1)
        normalized_label = re.sub(r'[^\x00-\x7f]', '', label).strip().lower()
        key = LABELS.get(normalized_label)
        if not key and re.match(r'^gross\s+(?:weight|wt)\s*\(kgs?\)$', normalized_label):
            key = 'gross_weight_kg'
        if key:
            return key, value.strip()
    lowered = stripped.lower()
    for alias in INLINE_ALIASES:
        if lowered == alias:
            return LABELS[alias], ''
        punctuation = re.match(r'^' + re.escape(alias) + r'\s*[.,]\s*(.+)$', stripped, re.IGNORECASE)
        if punctuation:
            return LABELS[alias], punctuation.group(1).strip()
        if lowered.startswith(alias) and len(stripped) > len(alias) and stripped[len(alias)].isspace():
            # Permit 'Consignee (Non-Negotiable) Party', but avoid a prefix
            # inside another word such as 'Containerized'.
            return LABELS[alias], stripped[len(alias):].strip()
    return None


def _observations(text: str) -> dict[str, list[tuple[str, str]]]:
    found: dict[str, list[tuple[str, str]]] = {name: [] for name in FIELD_NAMES}
    current: str | None = None
    lines: list[str] = []
    evidence_lines: list[str] = []
    def flush() -> None:
        nonlocal current, lines, evidence_lines
        if current and lines:
            evidence = '\n'.join(evidence_lines)
            found[current].append((' '.join(part.strip() for part in lines), evidence))
        current, lines, evidence_lines = None, [], []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or set(line) == {'='}:
            flush()
            continue
        matched = _label_line(line)
        if matched:
            flush()
            current, value = matched
            if value:
                lines.append(value)
                evidence_lines.append(raw)
            continue
        if current:
            # An unrelated labelled field ends a section; addresses such as
            # 'T. 82-2-...' may contain punctuation but have no label colon.
            if ':' in line and re.match(r'^[A-Za-z][A-Za-z .()/\-]{1,55}:', line) and not re.match(r'^(?:P\.?O\.?\s*Box|Tel|Telephone|Phone|Fax|T\.)\s*:', line, re.IGNORECASE):
                flush()
            else:
                lines.append(raw)
                evidence_lines.append(raw)
    flush()
    return found


def _clean(value: str) -> str:
    return re.sub(r'\s+', ' ', value).strip()


def _weight(value: str, evidence: str) -> str | None:
    number = NUMBER.search(value)
    if not number:
        return None
    try:
        amount = Decimal(number.group(1).replace(',', ''))
    except InvalidOperation:
        return None
    context = evidence.lower()
    if re.search(r'\b(?:mt|mts|metric\s+tons?)\b', context):
        amount *= 1000
    elif not re.search(r'\b(?:kg|kgs|kilograms?)\b', context):
        # ExtractFrom treats an unqualified gross-weight number as kilograms.
        # Keep a review warning rather than silently claiming an explicit unit.
        if not re.search(r'gross\s+(?:weight|wt)', context):
            return None
    return format(amount, 'f').rstrip('0').rstrip('.') if '.' in format(amount, 'f') else format(amount, 'f')


def _normalize(name: str, raw: str, evidence: str) -> str | None:
    value = _clean(raw)
    if not value or PLACEHOLDER.fullmatch(value):
        return None
    if name in ('port_of_loading', 'port_of_discharge'):
        value = PORT_STOP.sub('', value).strip()
    elif name == 'container_count':
        counts = [int(item) for item in CONTAINER.findall(value)]
        if counts:
            value = str(sum(counts))
        else:
            match = re.fullmatch(r'\d+', value)
            value = match.group() if match else ''
    elif name == 'gross_weight_kg':
        return _weight(value, evidence)
    return value or None


def extract_fields(text: str) -> tuple[ShipmentFields, list[str]]:
    observations = _observations(text)
    # Prefer an explicit total to per-container detail rows in a PDF table.
    total_weight = re.search(r'(?im)^\s*total\s+gross\s+(?:weight|wt)[^:\n]*:\s*([\d,\.]+\s*(?:KG|KGS|MT|MTS))', text)
    if total_weight:
        observations['gross_weight_kg'] = [(total_weight.group(1), total_weight.group(0))]
    fields = {}
    warnings = []
    for name in FIELD_NAMES:
        candidates = []
        for raw, evidence in observations[name]:
            value = _normalize(name, raw, evidence)
            if value:
                candidates.append((value, evidence))
        unique = {value for value, _ in candidates}
        if len(unique) > 1:
            fields[name] = ExtractedField(value=None, evidence=None)
            warnings.append(f'{name}: conflicting values; review required.')
        elif candidates:
            value, evidence = candidates[0]
            if name == 'gross_weight_kg' and not re.search(r'\b(?:kg|kgs|kilograms?|mt|mts|metric\s+tons?)\b', evidence, re.IGNORECASE):
                warnings.append('gross_weight_kg: unit inferred as kg from the gross-weight label; review required.')
            fields[name] = ExtractedField(value=value[:4000], evidence=evidence[:8000])
        else:
            fields[name] = ExtractedField(value=None, evidence=None)
            warnings.append(f'{name}: value unavailable or placeholder; review required.')
    return ShipmentFields(**fields), warnings
