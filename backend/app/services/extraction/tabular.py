"""Shared label/value formatting for Word and Excel tables."""
import re

_TRAILING_TRANSLATION = re.compile(r'\s*\([^\x00-\x7f]*[^\x00-\x7f][^)]*\)\s*$')
_WEIGHT_LABEL = re.compile(r'\b(?:gross\s+w(?:ei)?ght?|weight)\b', re.IGNORECASE)
_BARE_NUMBER = re.compile(r'[\d,\.\s]+')


def format_cells(values: list[str]) -> str:
    values = [value.strip() for value in values if value.strip()]
    if len(values) < 2:
        return values[0] if values else ''
    label = values[0]
    while _TRAILING_TRANSLATION.search(label):
        label = _TRAILING_TRANSLATION.sub('', label).strip()
    value = ' '.join(values[1:])
    if _WEIGHT_LABEL.search(label) and _BARE_NUMBER.fullmatch(value):
        # The label itself supplies the unit for a number-only cell.
        if re.search(r'\b(?:kgs?|kilograms?)\b', label, re.IGNORECASE):
            value += ' KG'
        elif re.search(r'\b(?:mts?|metric\s+tons?)\b', label, re.IGNORECASE):
            value += ' MT'
    return f'{label.rstrip(":")}: {value}'
