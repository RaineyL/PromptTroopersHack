# PromptTroopersHack

PromptTroopersHack is a system that allows **shipping email classification, document extraction, and SI/BL comparison**, built with **FastAPI and React**.

The system uses **DeepSeek (LLM) for email classification**, **extracts BL/SI documents for comparison requests**, **checks them against each other**, **routes uncertain cases to a human**, and **generates a JSON report**.

---

## What This Project Does

PromptTroopersHack provides the following workflow:

```text
Upload ZIP
    ↓
Classify Emails
    ↓
Is it BL_COMPARISON?
    ↓ Yes
Extract BL + SI
    ↓
Compare Documents
    ↓
Human Review if Required
    ↓
Export JSON Report
```

### Main capabilities

* **Email Classification** — Classifies shipping emails using DeepSeek.
* **Document Extraction** — Extracts information from TXT, PDF, DOCX, and XLSX files.
* **SI/BL Comparison** — Compares extracted fields from SI and BL documents.
* **Human Review** — Routes ambiguous, missing, conflicting, or unresolved cases for review.
* **JSON Reporting** — Generates the final `submission.json` report.
* **Debug Mode** — Allows Classification, Extraction, Comparison, and Report stages to be tested independently.

The`BL_COMPARISON` requests proceed to SI/BL extraction and comparison.

Server-side persistence and authentication are not implemented.

> **Security:** Do not expose the ZIP upload endpoint publicly without authentication and rate limiting.

---

# Tech Stack

| Component         | Technology          |
| ----------------- | ------------------- |
| Frontend          | React + Vite        |
| Backend           | FastAPI             |
| AI Classification | DeepSeek            |
| PDF OCR           | Tesseract + Poppler |
| Inbox Source      | Docker              |

---

# Quick Start

## Prerequisites

You need:

* Python 3.12+
* [uv](https://docs.astral.sh/uv/getting-started/installation/)
* Node.js 22.12+ within the 22.x line, or Node.js 24+
* npm
* Git
* [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) with English language data
* [Poppler](https://poppler.freedesktop.org/) for scanned PDF extraction

### macOS

```sh
brew install tesseract poppler
```

### Debian / Ubuntu

```sh
sudo apt-get install tesseract-ocr poppler-utils
```

---

## 1. Start the Backend

Run from the repository root:

```sh
cd backend
uv sync --locked
cp .env.example .env
```

Set the DeepSeek API key in `backend/.env`:

```env
DEEPSEEK_API_KEY=your_api_key_here
```

Then start FastAPI:

```sh
uv run python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Keep this terminal running.

---

## 2. Start the Frontend

Open a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Keep this terminal running.

---

## 3. Open the Application

Open:

**http://localhost:5173**

To stop either development server:

```text
Ctrl+C
```

---

## Local Services

| Service              | URL                                 |
| -------------------- | ----------------------------------- |
| Frontend             | http://localhost:5173               |
| Backend health       | http://127.0.0.1:8000/api/v1/health |
| Interactive API docs | http://127.0.0.1:8000/docs          |
| Alternative API docs | http://127.0.0.1:8000/redoc         |
| OpenAPI schema       | http://127.0.0.1:8000/openapi.json  |

---

# Repository Layout

```text
PromptTroopersHack/
├── README.md
├── AGENTS.md                  # Shared engineering standards
├── .gitignore
│
├── backend/
│   ├── AGENTS.md              # Backend coding-agent guidance
│   ├── pyproject.toml         # Python dependencies
│   ├── uv.lock                # Locked Python dependency resolution
│   │
│   ├── app/
│   │   ├── main.py            # FastAPI application and router registration
│   │   ├── api/
│   │   │   ├── health.py      # Health route and response model
│   │   │   └── comparison.py  # POST /api/v1/compare
│   │   │
│   │   ├── schemas/
│   │   │   └── comparison.py
│   │   │
│   │   └── services/
│   │       └── comparison/
│   │           ├── labels.py      # Document field labels
│   │           ├── normalize.py   # Per-field value normalization
│   │           └── engine.py      # Comparison rules and review routing
│   │
│   └── tests/                 # API and comparison tests
│
└── frontend/
    ├── AGENTS.md              # Frontend coding-agent guidance
    ├── .env.example           # Optional local proxy configuration
    ├── package.json
    ├── package-lock.json
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig*.json
    │
    └── src/
        ├── main.tsx           # React entry point
        ├── App.tsx            # Workspace shell and debug stages
        ├── features/
        │   ├── ClassificationWorkspace.tsx
        │   └── ComparisonWorkspace.tsx
        ├── App.css
        ├── index.css
        └── lib/
            └── api.ts         # API requests, types, validation
```

---

# Using the Pipeline

The main page provides the complete:

**Classify → Extract → Compare → Report**

workflow.

## Step 1 — Upload the ZIP

The Pipeline accepts a ZIP containing:

```text
inbox/
    *.json

attachments/
    ...
```

The files may optionally be inside one enclosing folder.

There is no fixed email-count limit. Large result tables are paginated by the dashboard.

Each archive is limited to:

* **50 MB compressed**
* **100 MB uncompressed source data**

The backend retains up to **four temporary ZIP sessions** in memory while active. Sessions expire after **four hours of inactivity**.

---

## Step 2 — Run the Pipeline

Click **Run pipeline**.

The system:

1. Classifies every uploaded email.
2. Identifies confirmed `BL_COMPARISON` emails.
3. Extracts the BL and SI documents for those emails.
4. Compares the extracted documents.
5. Keeps cases requiring human review unresolved.

Requests are sequential, and completed results remain visible if a later email fails.

Stopping a batch cancels browser requests. An in-flight provider call may still finish on the server.

---

## Step 3 — Inspect Results

You can filter the email table by category and click an email to inspect:

* Email message
* TXT attachments
* Other attachment paths
* Classification results
* Extraction results
* Comparison findings

---

## Step 4 — Resolve Human Review

Cases that cannot be safely resolved automatically are marked:

**Human Decision Required**

A person may optionally record:

* `OK`
* `MISMATCH`
* A decision note
* Defective fields for a mismatch

A decision can later be edited or returned to the unresolved state.

Until a human decision is made, the JSON keeps:

```text
NEEDS_REVIEW
```

and does not claim a confirmed defect.

---

## Step 5 — Export the Report

Click:

**Export JSON report**

The Pipeline downloads:

```text
submission.json
```

Export is disabled when:

* Classification has no category, or
* A confirmed `BL_COMPARISON` has not completed extraction and comparison.

---

# Debug Mode

Debug mode allows the individual stages to be tested independently.

Available workspaces:

```text
Debug
├── Classification
├── Extraction
├── Comparison
└── Report
```

Debug state is separate from the main Pipeline.

Navigation preserves session state and supports browser back/forward.

Refreshing clears active workspace results and decisions, but saved extraction snapshots remain available.

---

# Classification

## Classification API and DeepSeek Setup

From `backend/`:

```sh
cp .env.example .env
```

Set:

```env
DEEPSEEK_API_KEY=your_api_key_here
```

Then launch:

```sh
uv run python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The defaults are:

```text
DEEPSEEK_BASE_URL = https://api.deepseek.com
DEEPSEEK_MODEL    = deepseek-flash
```

Keys stay on the server.

Only the following are transmitted to the classifier:

* Email text
* Attachment filename metadata

Attachment contents are **not** sent to the classifier.

The model treats email contents as untrusted data.

Outbound calls have:

* 60-second timeouts
* At most three attempts per classification/audit
* Bounded backoff
* No retries for non-transient HTTP errors

---

## Classification API

### `POST /api/v1/classify`

Example request:

```json
{
  "email": {
    "email_id": "demo_001",
    "from": "operations@example.com",
    "subject": "Check draft BL",
    "body": "Please compare the draft BL against the SI.",
    "attachments": [
      "demo_001_SI.txt",
      "demo_001_BL.txt"
    ]
  }
}
```

Classification always uses **DeepSeek-only**.

The request contains only `email`.

The old `mode` field is no longer supported and is rejected with HTTP 422.

The response contains:

* `classification`
* optional `audit`
* `audit_risk_flags`

The frontend uses the classification and review information to determine whether the email proceeds to extraction.

### Review behavior

The following require review:

* Ambiguous evidence
* Insufficient evidence
* Audit disagreement

The initial prediction is preserved together with the competing category.

A failed audit fails the request instead of returning an unaudited decision.

### HTTP responses

| Status | Meaning                            |
| ------ | ---------------------------------- |
| `422`  | Invalid input                      |
| `503`  | Missing server configuration       |
| `502`  | Provider failure or invalid output |

---

# Extraction

Extraction is performed for confirmed `BL_COMPARISON` requests.

## Extraction Debug

Open:

**Debug → Extraction**

Then:

1. Click **Request BL_COMPARISON emails**.
2. Select an ID.
3. Click **Request selected email**.
4. Click **Run extraction test**.

The catalog reads only category eligibility from:

```text
../sdoc-hackathon-docker/data_v2/ground_truth.json
```

When using another checkout or container, set:

```text
EXTRACTION_DEBUG_GROUND_TRUTH
```

to an absolute path.

Missing or invalid catalogs produce an actionable error.

Ground-truth statuses, defect flags, and defect fields are not returned to the UI or used by extraction.

Only the selected eligible email is fetched from Docker.

---

## Supported Document Types

The extraction module supports:

* TXT
* PDF
* DOCX
* XLSX

Each format uses its own reader.

A shared seven-field label parser is then used for the extracted content.

Results show:

**BL on the left, SI — Source of Truth on the right**

On narrow screens, BL is displayed above SI.

The UI provides two JSON panels with matching field keys. Each panel can expand to show the full response and source evidence.

---

## Extraction Rules

### TXT

TXT extraction tries:

* UTF-8
* Windows encodings

### DOCX

DOCX extraction includes:

* Paragraphs
* Tables
* Headers
* Footers

### XLSX

XLSX is interpreted as label/value rows.

Formulas are not evaluated.

### PDF

PDF extraction:

1. Reads available page text.
2. Runs local OCR on pages without usable text.

### Field Processing

The shared parser:

* Normalizes label synonyms.
* Rejects placeholder values.
* Converts metric tonnes to kilograms.
* Marks conflicting fields for review.
* Marks missing fields for review.
* Treats unknown labels as requiring review.

A bare number under a gross-weight label is treated as kilograms with an explicit review warning.

OCR results can contain recognition errors. Check the source text and extracted evidence before accepting a comparison.

---

## Extraction Limits

| Limit                           | Maximum |
| ------------------------------- | ------: |
| Attachment size                 |   10 MB |
| Text characters                 | 100,000 |
| PDF pages                       |      30 |
| Expanded Office archive content |   25 MB |
| Spreadsheet rows                |  10,000 |
| Spreadsheet columns             |     100 |

Only one filename-identified BL and one SI can be extracted per run.

The following require review:

* Missing candidates
* Multiple candidates
* A document whose content identifies another type
* Conflicting fields
* Missing fields
* Extraction errors

A failure on one side preserves the other side's result.

---

## Extraction API

### `POST /api/v1/extract`

Example:

```json
{
  "email_id": "email_001"
}
```

Pipeline uses this endpoint after classification confirms `BL_COMPARISON`.

### Debug endpoints

```text
GET  /api/v1/debug/extraction/emails
GET  /api/v1/debug/extraction/emails/{email_id}
POST /api/v1/debug/extraction
```

The POST request accepts:

```json
{
  "email_id": "email_001"
}
```

Each side returns one of:

```text
extracted
needs_review
error
```

HTTP `422` rejects ineligible IDs.

HTTP `503` reports a missing catalog.

Document failures appear on the affected side.

> Extraction is **not** discrepancy comparison. This stage only produces extracted values and evidence. It does not produce a match/mismatch verdict.

---

# Comparison

## Comparison API

### `POST /api/v1/compare`

The endpoint accepts the **exact extraction response**:

```json
{
  "email": {},
  "bl": {},
  "si": {}
}
```

Each field contains:

```json
{
  "value": "...",
  "evidence": "..."
}
```

The JSON returned by `/api/v1/extract` or downloaded from Extraction Debug can be sent unchanged.

For a batch:

```json
{
  "extractions": [
    {}
  ]
}
```

The older format:

```json
{
  "documents": []
}
```

is still supported for API compatibility.

---

## Comparison Rules

Comparison uses the extracted values.

`source_text` never overrides extracted values.

Gross weight is already in kilograms and is not converted again.

Email IDs and explicit BL/SI sides define pairs, so attachment filenames do not need special suffixes.

Missing, multiple, erroneous, or unresolved extraction results produce:

```text
NEEDS_REVIEW
```

rather than reporting a clean comparison.

---

## Comparison Results

Each email produces one of:

```text
OK
MISMATCH
NEEDS_REVIEW
```

When both documents can be compared, each result also contains seven field decisions:

```text
match
mismatch
review
```

A confirmed mismatch can coexist with fields requiring review.

Comparison uses deterministic local rules and requires:

* No model key
* No external calls

Comparison thresholds are defined in:

```text
backend/app/services/comparison/engine.py
```

---

## Comparison Debug

Open:

**Debug → Comparison**

Then:

1. Choose a result under **Saved extraction results**.
2. Click **Use saved extraction**.
3. Click **Run comparison test**.

You can also:

* Paste an extraction download.
* Import an extraction download.
* Import an array of downloads.
* Import a batch under `extractions`.

Comparison Debug does not modify Pipeline or Classification Debug.

---

# Report

## Pipeline Report

The Pipeline exports:

```text
submission.json
```

The report uses the same per-email keys as:

```text
../sdoc-hackathon-bundle/sample_submission.json
```

The keys are:

```text
category
status
review_reason
defect_fields
has_defect
```

Non-comparison categories receive `OK` with no defect fields when confirmed.

An unconfirmed model category remains provisional and is exported as:

```text
NEEDS_REVIEW
```

with:

```text
uncertain_value
```

It is never reported as a clean result.

Every unresolved case is labelled:

**Human Decision Required**

A person may optionally record `OK` or `MISMATCH`, together with a decision note and defective fields for a mismatch.

The report does not:

* Read ground truth
* Send document contents to another service

---

## Report Debug

Open:

**Debug → Report**

Paste the JSON exported from:

* Classification
* Comparison

Then choose:

**Build report test**

Both exports are saved together as:

```text
Run #1
Run #2
Run #3
...
```

The latest 20 runs are retained.

A saved run can be selected to restore both inputs and build the report again.

If browser storage is unavailable or full, the run remains available for the current session and a visible warning is shown.

Debug inputs and outputs remain separate from the Pipeline session.

The report is assembled in the browser and downloaded locally.

There is no report API or server-side storage.

---

# Docker Inbox Source

Start the inbox service from:

```sh
cd ../sdoc-hackathon-docker/
docker compose up --build
```

The backend reads its public HTTP API at:

```text
http://127.0.0.1:8080
```

Override it with:

```env
INBOX_BASE_URL=http://127.0.0.1:8080
```

The backend loads this setting automatically at startup.

If the backend also runs inside a container, use an origin reachable from that container.

### Pipeline vs Debug

The Pipeline uses the uploaded ZIP instead of Docker.

Debug provides the Docker picker with an optional attachment checkbox, as well as manual JSON and file inputs.

Each workspace keeps its own session.

---

## Inbox API

The backend exposes:

```text
POST /api/v1/inbox/upload
GET  /api/v1/inbox/emails
GET  /api/v1/inbox/emails/{email_id}
GET  /api/v1/inbox/emails/{email_id}/attachments/{path}
```

The upload endpoint accepts a raw ZIP and returns:

* An opaque session ID
* An email list

Attachment requests verify membership in the selected email.

The `X-Inbox-Session` header selects the uploaded ZIP for inbox reads and `/api/v1/extract`.

Without the header, those endpoints use Docker.

Requests have:

* 20-second upstream timeouts
* 10 MB response limit

The browser limits total attachments per email to 20 MB.

Empty inboxes, missing resources, and connection failures are shown explicitly.

Attachment bytes remain in the browser session and are not included in classification exports or sent to DeepSeek.

Pipeline and Debug extraction use the same local extraction module.

Comparison consumes the extraction output directly.

---

# Browser Storage and Session History

Completed Pipeline and Extraction Debug responses are automatically saved in browser local storage.

Saved information includes:

* Fields
* Evidence
* Source text
* Warnings
* Errors

Comparison Debug can load a copy without changing the original workspace.

History retains the latest result per email and source workspace, up to **20 entries**.

Saved results survive refreshes on the same browser and site origin.

They are not shared between:

* Different browsers
* Different ports

If browser storage is full or unavailable, a visible warning explains that new results are session-only.

JSON downloads remain available as a backup.

---

# Development and Verification

## Backend

Run backend commands from:

```text
backend/
```

Run tests:

```sh
uv run python -m unittest discover -s tests -v
```

Add dependencies with:

```sh
uv add <package>
```

Development dependencies:

```sh
uv add --dev <package>
```

Commit the corresponding manifest and lockfile together.

Use:

```sh
uv sync --locked
```

for reproducible installation.

---

## Frontend

Run frontend commands from:

```text
frontend/
```

Run:

```sh
npm run lint
npm run typecheck
npm run build
npm run preview
```

The production build is written to:

```text
frontend/dist/
```

Preview serves the build at:

```text
http://localhost:4173
```

Preview requires the backend for API calls.

Preview is for local verification, not production hosting.

Add frontend dependencies with:

```sh
npm install <package>
```

or:

```sh
npm install -D <package>
```

---

## Browser Storage Tests

Run:

```sh
node --experimental-strip-types --test tests/extractionHistory.test.mjs tests/reportHistory.test.mjs tests/report.test.mjs
```

---

## Integration Smoke Check

Start both services and run:

```sh
curl --fail http://127.0.0.1:8000/api/v1/health
curl --fail http://localhost:5173/api/v1/health
```

Both should return the same health response.

In the browser:

1. Classify the example with DeepSeek.
2. Confirm any required review decision.
3. Export the report.
4. Stop the backend.
5. Classify again to verify visible failure and retry behavior.

---

# Offline Batch Evaluation

The POC's resumable runner and metrics are available inside this project.

Dataset and answer key are supplied explicitly so that ground truth remains separate from the classifier.

Run from `backend/`:

```sh
uv run python -m app.services.classification.evaluate \
  --dataset ../../sdoc-hackathon-bundle \
  --ground-truth ../../sdoc-hackathon-docker/data_v2/ground_truth.json \
  --fresh
```

The runner:

* Uses DeepSeek-only.
* Loads `backend/.env`.
* Supports `--env-file`.
* Defaults to four workers.
* Checkpoints completed predictions.
* Retries failed emails on the next run.

For a smoke test:

```text
--max-emails 5
```

Outputs are ignored under:

```text
backend/output/classification/
```

Model metrics exclude unresolved review cases and report automatic coverage.

Comparison fields in the compatibility submission are placeholders, with comparison cases marked for review.

This offline runner evaluates **classification only**.

Comparison is available separately through the API and UI.

The source POC and its existing evaluation outputs are unchanged.

Regression tests use fake model clients and never send emails to a live provider.

---

# Selected Method and Recorded Accuracy

The selected method is:

```text
DeepSeek-only
Model: deepseek-flash
```

The source POC evaluation recorded:

```text
520 / 520 saved predictions matched the supplied ground truth
Accuracy: 1.0
Macro-F1: 1.0
Human-review exclusions: 0
```

This is the **recorded dataset result** from the original saved POC run.

It is **not a guarantee for future emails or a new live evaluation**.

Ground truth is used only for evaluation and is never passed to the classification model.

Numeric model confidence has been removed from:

* Prompts
* API responses
* UI
* Exports

Human review relies on:

* Explicit ambiguity flags
* Second-pass audit findings

The 520/520 result belongs to the original saved POC run.

The revised prompt without confidence has not been evaluated live.

Use:

```text
--fresh
```

for the new evaluation version.

Hybrid and local-rule classifiers have been removed from this project.

---

# Deployment

Build the frontend:

```sh
npm ci && npm run build
```

Serve:

```text
frontend/dist/
```

using a static host or web server.

Start the backend without reload:

```sh
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

For production deployment:

* Configure a reverse proxy to forward `/api/*` to FastAPI.
* Preserve the `/api/*` path.
* Serve frontend assets on the same origin.
* If client-side routing is introduced, configure an HTML fallback.
* If a separate API origin is used, update the frontend API base URL.
* Configure explicit FastAPI CORS origins when using a separate API origin.
* Configure TLS.
* Configure authentication.
* Secure secrets.
* Configure process management.
* Configure infrastructure appropriate for the deployment environment.

The Vite proxy is **not included** in the static production build.

---

# Security and Limitations

## Authentication

Server-side persistence and authentication are not implemented.

Do not expose the ZIP upload endpoint publicly without:

* Authentication
* Rate limiting

Do not expose the unauthenticated demo API publicly without authentication and rate limits.

---

## Data and Sessions

Pipeline results and decisions are session-only.

**Export before leaving the application.**

The system currently retains up to four temporary ZIP sessions in memory while active.

Each session has a four-hour idle expiry.

---

## File Limits

Uploaded ZIP archives:

* Maximum 50 MB compressed
* Maximum 100 MB uncompressed

Extraction limits:

* 10 MB per attachment
* 100,000 text characters
* 30 PDF pages
* 25 MB expanded Office archive content
* 10,000 spreadsheet rows
* 100 spreadsheet columns

---

## Document Accuracy

OCR can contain recognition errors.

Missing, multiple, erroneous, conflicting, or unresolved extraction results are routed to review.

No mismatch-free result is claimed for an unprocessed document.

Extraction does not produce a match/mismatch verdict.

Comparison only operates on the extracted results.

---

## Data Sent to DeepSeek

Classification sends:

* Email text
* Attachment filename metadata

Attachment contents are not sent to the classifier.

Extraction is local and does not send document contents to DeepSeek.

---

## Secrets

Never commit secrets.

Local `.env` files are ignored.

Sanitized `.env.example` files may be committed.

Any future `VITE_*` variable is exposed in browser bundles and must not contain secrets.

---

# UI and Design

The interface follows the locally installed `ui-ux-pro-max` skill.

The UI is designed as a responsive operations console with:

* Blue actions
* Navy sidebar
* Explicit stage statuses
* Keyboard focus
* Reduced-motion support

Project-specific design rules are recorded in:

```text
AGENTS.md#product-ui-design
```

---

# Extending the Project

## Backend

Add backend routers under:

```text
backend/app/api/
```

Register them in:

```text
backend/app/main.py
```

Add schemas, services, and persistence modules when needed.

## Frontend

Centralize frontend API calls in:

```text
frontend/src/lib/api.ts
```

Add reusable components, feature folders, or hooks as features emerge.

## API Changes

Coordinate request and response changes across both applications.

Add meaningful behavior tests for changes.

## Coding Agents

Coding agents should read:

```text
AGENTS.md
backend/AGENTS.md
frontend/AGENTS.md
```

before editing the corresponding application.

---

# Framework References

* [FastAPI application structure](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
* [Vite getting started](https://vite.dev/guide/)
* [React documentation](https://react.dev/)
