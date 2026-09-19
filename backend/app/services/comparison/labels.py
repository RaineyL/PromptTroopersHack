"""Recover each document's own field labels from its raw text.

Extraction already returns the seven canonical field names, so comparison does
not need this to know *what* a value is. It needs it for two other reasons:

1. The discrepancy report must show the label the document actually used --
   'Consignee (Non-Negotiable)' against 'To the Order of' -- because that is
   what a reviewer checks the finding against.
2. Party values arrive with the postal address appended, and the separator
   differs per source format ('|' in spreadsheets, a line break in Word and
   plain text). The company name is the first line of the value, so reading the
   label line back out of the raw text is the reliable way to split the name
   from the address. Comparing the joined string instead scores two different
   companies at a false 0.82 when they happen to share a consignee address.
"""

import re
import unicodedata

FIELDS: tuple[str, ...] = (
    'shipper',
    'consignee',
    'notify_party',
    'port_of_loading',
    'port_of_discharge',
    'container_count',
    'gross_weight_kg',
)

FIELD_TITLES: dict[str, str] = {
    'shipper': 'Shipper',
    'consignee': 'Consignee',
    'notify_party': 'Notify party',
    'port_of_loading': 'Port of loading',
    'port_of_discharge': 'Port of discharge',
    'container_count': 'Container count',
    'gross_weight_kg': 'Gross weight (kg)',
}

_CJK = re.compile(r'[⺀-鿿豈-﫿＀-￯]')


def clean_label(raw: str) -> str:
    """Normalise a label for lookup: drop CJK glosses, punctuation and case."""
    text = _CJK.sub(' ', raw)
    text = unicodedata.normalize('NFKD', text).replace(' ', ' ')
    text = re.sub(r"[^A-Za-z0-9/&' ]+", ' ', text)
    return re.sub(r'\s+', ' ', text).strip().lower()


_SYNONYMS: dict[str, str] = {}


def _register(field: str, *labels: str) -> None:
    for label in labels:
        _SYNONYMS[clean_label(label)] = field


_register('shipper', 'Shipper', 'Shipper/Exporter', 'Shipper (Principal or Seller)', 'Exporter', 'Consignor', 'Shipper/Consignor')
_register('consignee', 'Consignee', 'Consignee (Non-Negotiable)', 'To the Order of', 'To Order of', 'Consigned to', 'Receiver')
_register('notify_party', 'Notify', 'Notify Party', 'Notify Party/Intermediate Consignee', 'Intermediate Consignee', 'Also Notify')
_register('port_of_loading', 'Port of Loading', 'Port of Loading (POL)', 'POL', 'Load Port', 'Loading Port')
_register('port_of_discharge', 'Port of Discharge', 'Port of Discharge (POD)', 'POD', 'Discharge Port', 'Unloading Port')
_register('container_count', 'Total Containers', 'Container Count', 'No. of Containers', 'No. of Containers or Packages', 'Number of Containers', 'Containers', 'No. of Pkgs')
_register('gross_weight_kg', 'Gross Weight', 'Gross Wt (kgs)', 'Gross Weight (KG)', 'Gross Weight (KGS)', 'Total Gross Weight', 'Gross Wt', 'Gross Weight (MT)')

# Checked before the synonym table: these contain a field's keywords but are a
# different field. 'NET WEIGHT' is not the gross weight; 'CONTAINER NO.' is not
# a count. Specificity before generality, or the wrong value wins.
_NEGATIVE = re.compile(
    r'\bnet weight\b|\bnet wt\b|\btare\b|\bcontainer no\b|\bcontainer number\b|'
    r'\bseal\b|\bplace of receipt\b|\bplace of delivery\b|\bfinal destination\b|'
    r'\bkinds of packages\b|\bdescription of goods\b'
)


def map_label(raw_label: str) -> str | None:
    """Return the canonical field a document label refers to, or None."""
    cleaned = clean_label(raw_label)
    if not cleaned or _NEGATIVE.search(cleaned):
        return None
    return _SYNONYMS.get(cleaned)


# Fields whose value is a name, not a number. Only these use the label-on-its-
# own-line and label-prefix layouts: a PDF's per-container table repeats
# 'GROSS WEIGHT (KG)' as a column header, and taking the line under it would
# read a container serial number as a weight.
_NAME_FIELDS = frozenset({'shipper', 'consignee', 'notify_party',
                          'port_of_loading', 'port_of_discharge'})

# Longest first, so 'port of discharge' is tested before 'pod' and
# specificity is never lost to a shorter label that also matches.
_LABEL_PREFIXES: list[str] = sorted(_SYNONYMS, key=len, reverse=True)


def _split_by_label(line: str) -> tuple[str, str] | None:
    """Split 'Consignee (Non-Negotiable) BALL & DOGGETT PTY LTD' with no colon.

    The split point is found by cleaning progressively longer word prefixes
    until one equals a known label. Slicing by word count instead would
    misfire whenever cleaning changes the count -- 'Consignee (Non-Negotiable)'
    is two raw words but three cleaned ones.
    """
    words = line.split()
    if len(words) < 2:
        return None
    cleaned = {clean_label(' '.join(words[:count])): count
               for count in range(1, min(len(words), 8) + 1)}
    for prefix in _LABEL_PREFIXES:
        count = cleaned.get(prefix)
        if count and count < len(words):
            return ' '.join(words[:count]), ' '.join(words[count:])
    return None


def read_labelled_lines(raw_text: str) -> dict[str, tuple[str, str]]:
    """Map each canonical field to (label as written, value on the label line).

    Three layouts appear across the source formats:
      'Shipper: ACME LTD'        plain text, spreadsheets, Word
      'Shipper' / 'ACME LTD'     PDFs, label alone with the value beneath
      'Consignee ACME LTD'       PDFs, label and value sharing a line

    Only the value beside the label is captured. Continuation lines -- the
    postal address under a party name -- are deliberately left out, which is
    exactly the split the party comparison needs.

    A label present with an empty value is recorded as an empty string rather
    than skipped: that is positive evidence the document left the field blank,
    and it must win over a value an extractor guessed from nearby text.
    """
    lines = (raw_text or '').splitlines()
    found: dict[str, tuple[str, str]] = {}

    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or set(stripped) <= {'=', '-', '_'}:
            continue

        match = re.match(r'^\s{0,3}([^:]{1,60}?)\s*:\s*(.*)$', line)
        if match:
            label, value = match.group(1).strip(), match.group(2).strip()
            field = map_label(label)
            if field is None:
                continue
            # A later label wins only when it is explicitly the document total,
            # which is what a per-container table is summarised by.
            if field in found and 'total' not in label.lower():
                continue
            found[field] = (label, value)
            continue

        field = map_label(stripped)
        if field in _NAME_FIELDS and field not in found:
            following = next((later.strip() for later in lines[index + 1:] if later.strip()), '')
            found[field] = (stripped, following)
            continue

        split = _split_by_label(stripped)
        if split:
            label, value = split
            field = map_label(label)
            if field in _NAME_FIELDS and field not in found:
                found[field] = (label, value)

    return found
