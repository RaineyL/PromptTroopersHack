"""Debug-only category gate. Never expose or use answer-key defect fields."""
import json
import os
from pathlib import Path
import re

from fastapi import HTTPException

from app.services.inbox import InboxClient

# In the full repository this resolves to the organizer-only scoring fixture.
# A standalone deployment image contains only ``backend/``, so resolve from the
# backend root instead of indexing past the filesystem root during import.
BACKEND_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_GROUND_TRUTH = BACKEND_ROOT.parent.parent / 'sdoc-hackathon-docker/data_v2/ground_truth.json'


class ExtractionCatalog:
    def email_ids(self) -> list[str]:
        path = Path(os.environ.get('EXTRACTION_DEBUG_GROUND_TRUTH', str(DEFAULT_GROUND_TRUTH)))
        try:
            with path.open() as stream:
                records = json.load(stream)
            if not isinstance(records, dict) or any(
                not isinstance(row, dict) or not isinstance(row.get('category'), str)
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', email_id)
                for email_id, row in records.items()
            ):
                raise ValueError('Invalid category catalog')
            return sorted(email_id for email_id, row in records.items() if row['category'] == 'BL_COMPARISON')
        except (OSError, ValueError) as exc:
            raise HTTPException(503, 'Extraction Debug category catalog is unavailable. Check EXTRACTION_DEBUG_GROUND_TRUTH.') from exc

    def require_eligible(self, email_id: str) -> None:
        if email_id not in self.email_ids():
            raise HTTPException(422, 'Extraction Debug accepts only ground-truth BL_COMPARISON emails.')

    def email(self, email_id: str, inbox: InboxClient):
        self.require_eligible(email_id)
        return inbox.emails(email_id)[0]
