"""Turn an extracted value into something two documents can be compared on.

Each field gets its own normaliser, because 'the same' means something
different for a company name, a port, a container count and a weight. The raw
value is always carried through untouched so the report can show a reviewer
exactly what the document said.
"""

import re
import unicodedata
from dataclasses import dataclass, field as dataclass_field
from typing import Any

# A blank that is styled like a value. These appear in the dataset as filled-in
# looking placeholders and must not be read as data.
_PLACEHOLDER = re.compile(
    r'^[\s_\-.]*$|^[\s_\-.]*(mt|mts|kg|kgs|tbd|tba|n/?a|nil|none|xxx+|\?+)[\s_\-.]*$',
    re.IGNORECASE,
)

_UNITS = {
    'KG': 1.0, 'KGS': 1.0, 'KGM': 1.0,
    'MT': 1000.0, 'MTS': 1000.0, 'T': 1000.0,
    'TON': 1000.0, 'TONS': 1000.0, 'TONNE': 1000.0, 'TONNES': 1000.0,
    'LB': 0.45359237, 'LBS': 0.45359237,
}

# Only a parenthesised trailing token is a UN/LOCODE. Matching a bare trailing
# word would eat the country out of 'NANTONG, CHINA'.
_LOCODE = re.compile(r'\(\s*([A-Z]{2}[A-Z0-9]{3})\s*\)\s*$')


@dataclass(slots=True)
class Value:
    """A normalised field value plus everything a reviewer needs to check it."""

    raw: str
    label: str = ''
    comparable: Any = None
    present: bool = True
    note: str = ''
    extra: dict[str, Any] = dataclass_field(default_factory=dict)


def _is_placeholder(text: Any) -> bool:
    return not str(text or '').strip() or bool(_PLACEHOLDER.match(str(text).strip()))


def _ascii_upper(text: str) -> str:
    normalised = unicodedata.normalize('NFKD', text)
    return ''.join(char for char in normalised if not unicodedata.combining(char)).upper()


def party(raw: Any, label: str = '', name_line: str | None = None) -> Value:
    """Compare on the company name only; the postal address is not a check field.

    `name_line` is the value as it appeared on its own label line in the source
    document, which is the company name with no address attached. When it is
    available it is authoritative. Otherwise the name is taken as the first
    segment before a '|' or ';', which covers the spreadsheet layout.
    """
    text = str(raw or '')
    if _is_placeholder(text) and not name_line:
        return Value(raw=text, label=label, present=False, note='no party name given')

    # The company name is the first segment either way: spreadsheets put the
    # address after a '|' on the same line, other formats put it on the lines
    # below, which never reach `name_line`.
    source = name_line if name_line is not None else text
    name = re.split(r'\s*[|;]\s*', str(source).strip())[0].strip()
    comparable = _ascii_upper(name)
    comparable = re.sub(r'[.,]+', ' ', comparable)
    comparable = re.sub(r"[^A-Z0-9&' ]+", ' ', comparable)
    comparable = re.sub(r'\s+', ' ', comparable).strip()
    if not comparable:
        return Value(raw=text, label=label, present=False, note='no party name given')

    address = text[len(name):].strip(' |;,') if text.startswith(name) else ''
    return Value(raw=text, label=label, comparable=comparable,
                 extra={'name': name, 'address': address})


def port(raw: Any, label: str = '') -> Value:
    """Compare on the port name; treat a UN/LOCODE as corroboration, not identity.

    The dataset's injected port defects replace the city and leave the code
    untouched, so a comparison that reduces a port to its code misses them
    entirely. Punctuation between city and country is noise: 'GDANSK POLAND.'
    and 'GDANSK, POLAND' are the same port.
    """
    text = str(raw or '')
    if _is_placeholder(text):
        return Value(raw=text, label=label, present=False, note='no port given')

    upper = re.split(r'\s*\|\s*', _ascii_upper(text.strip()))[0]
    code = None
    match = _LOCODE.search(upper)
    if match:
        code = match.group(1)
        upper = upper[:match.start()].strip()

    name = re.sub(r'[^A-Z0-9 ]+', ' ', upper)
    name = re.sub(r'\s+', ' ', name).strip()
    if not name and not code:
        return Value(raw=text, label=label, present=False, note='no port given')
    return Value(raw=text, label=label, comparable=name or code,
                 extra={'name': name, 'locode': code})


def container_count(raw: Any, label: str = '') -> Value:
    """Read the count out of '6 x 40\\'HC'. 40'HC is the box type, not a quantity."""
    if _is_placeholder(raw):
        return Value(raw=str(raw or ''), label=label, present=False,
                     note='no container count given')
    text = str(raw).strip()

    match = re.match(r"\s*(\d[\d,]*)\s*[x*×]\s*(\S+)", text, re.IGNORECASE)
    if match:
        return Value(raw=text, label=label,
                     comparable=int(match.group(1).replace(',', '')),
                     extra={'container_type': match.group(2)})

    # A scan can lose the separator: '120FCL' is 1 x 20'FCL, not 120 boxes.
    # Split on a standard box size rather than trusting the digit run.
    match = re.match(r"\s*(\d{3,})\s*['’°]?\s*([A-Z]{2,4})\b", text, re.IGNORECASE)
    if match:
        digits = match.group(1)
        for size in ('45', '40', '20'):
            if digits.endswith(size) and len(digits) > len(size):
                return Value(raw=text, label=label, comparable=int(digits[:-len(size)]),
                             extra={'container_type': size + match.group(2),
                                    'note': 'size separator missing in source'})

    match = re.search(r'\d[\d,]*', text)
    if not match:
        return Value(raw=text, label=label, present=False,
                     note=f'no number found in {text!r}')
    return Value(raw=text, label=label, comparable=int(match.group(0).replace(',', '')))


def gross_weight_kg(raw: Any, label: str = '') -> Value:
    """Parse a weight to kilograms, converting any unit the document used."""
    if _is_placeholder(raw):
        return Value(raw=str(raw or ''), label=label, present=False,
                     note=f'placeholder weight {str(raw or "").strip()!r}')
    if isinstance(raw, (int, float)):
        return Value(raw=f'{raw:,.0f}', label=label, comparable=round(float(raw), 2),
                     extra={'unit_seen': 'KG'})

    text = _ascii_upper(str(raw)).replace('|', ' ')
    match = re.search(r'(\d[\d,. ]*\d|\d)', text)
    if not match:
        return Value(raw=str(raw), label=label, present=False,
                     note=f'no number found in {raw!r}')

    number = match.group(1).replace(' ', '')
    if ',' in number and '.' in number:
        number = (number.replace('.', '').replace(',', '.')
                  if number.rfind(',') > number.rfind('.') else number.replace(',', ''))
    elif ',' in number:
        number = number.replace(',', '') if re.search(r',\d{3}\b', number) else number.replace(',', '.')
    elif re.fullmatch(r'\d{1,3}\.\d{3}', number):
        # '22.825' is a thousands separator or an OCR'd comma. 22.825 kg of
        # containerised cargo is not a real shipment; 22,825 kg is.
        number = number.replace('.', '')
    elif number.count('.') > 1:
        number = number.replace('.', '')

    try:
        amount = float(number)
    except ValueError:
        return Value(raw=str(raw), label=label, present=False,
                     note=f'unreadable weight {raw!r}')

    unit = 'KG'
    unit_match = re.search(r'\b(KGS?|KGM|MTS?|TONNES?|TONS?|LBS?|T)\b', text[match.end():])
    if not unit_match:
        unit_match = re.search(r'\b(KGS?|KGM|MTS?|TONNES?|TONS?|LBS?)\b', _ascii_upper(label))
    if unit_match:
        unit = unit_match.group(1)

    return Value(raw=str(raw), label=label,
                 comparable=round(amount * _UNITS.get(unit, 1.0), 2),
                 extra={'unit_seen': unit, 'value_as_written': amount})


NORMALISERS = {
    'shipper': party,
    'consignee': party,
    'notify_party': party,
    'port_of_loading': port,
    'port_of_discharge': port,
    'container_count': container_count,
    'gross_weight_kg': gross_weight_kg,
}
