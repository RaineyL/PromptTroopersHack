# PromptTroopersHack

Shipping email classification and document extraction with FastAPI and React. Integrates the latest `classify_POC` DeepSeek-only review gate, prompts, and second-pass DeepSeek audit as a self-contained backend package. No sibling POC folder is required at runtime.

The Pipeline UI requests emails and attachments from Docker. Debug also imports JSON inbox files (one record or an array). The UI runs DeepSeek-only classification, displays evidence and audit decisions, and supports human confirmation/correction and JSON report export. Failed or stopped emails can be retried. Results and human decisions are session-only; export before leaving. Requests are sequential and completed results remain visible if a later email fails. Stopping a batch cancels browser requests; an in-flight provider call may finish on the server.

Scope: **Pipeline classification and extraction, plus independent Debug stage tests**. Only confirmed `BL_COMPARISON` requests are marked for document comparison. Confirmed comparison emails proceed to SI/BL extraction in Pipeline; extraction can also run independently in Debug. Seven-field comparison, OCR, persistence, and authentication remain unimplemented. No mismatch-free result is claimed for an unprocessed document.

## Prerequisites

- Python 3.12 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/).
- Node.js 22.12+ within the 22.x line, or Node.js 24+, and npm (included with Node).
- Git.

## Quick start

Run these commands from the repository root (`PromptTroopersHack/`) in two separate terminals.

**Terminal 1 — backend**

```sh
cd backend
uv sync --locked
cp .env.example .env  # set DEEPSEEK_API_KEY in .env
uv run python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**

```sh
cd frontend
npm ci
npm run dev
```

Open [the frontend](http://localhost:5173). Configure DeepSeek below before classifying emails. Stop either development server with Ctrl+C.

| Service | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend health | http://127.0.0.1:8000/api/v1/health |
| Interactive API docs | http://127.0.0.1:8000/docs |
| Alternative API docs | http://127.0.0.1:8000/redoc |
| OpenAPI schema | http://127.0.0.1:8000/openapi.json |

## Repository layout

```text
PromptTroopersHack/
├── README.md
├── AGENTS.md                  # Shared engineering standards
├── .gitignore
├── backend/
│   ├── AGENTS.md             # Backend coding-agent guidance
│   ├── pyproject.toml         # Python dependencies
│   ├── uv.lock                # Locked Python dependency resolution
│   ├── app/
│   │   ├── main.py            # FastAPI application and router registration
│   │   └── api/health.py      # Health route and response model
│   └── tests/test_health.py   # API smoke tests
└── frontend/
    ├── AGENTS.md              # Frontend coding-agent guidance
    ├── .env.example           # Optional local proxy configuration
    ├── package.json
    ├── package-lock.json
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig*.json
    └── src/
        ├── main.tsx          # React entry point
        ├── App.tsx           # Email import, results, and human review
        ├── App.css
        ├── index.css
        └── lib/api.ts        # API requests, types, and response validation
```

## API and configuration

`GET /api/v1/health` returns HTTP 200:

```json
{"status":"ok","service":"PromptTroopersHack API"}
```

This is a process liveness check; it does not check external dependencies. API routes use the `/api/v1` prefix.

The frontend posts classification requests to `/api/v1/classify` on its own origin. Vite forwards `/api/*` to `http://127.0.0.1:8000`, preserving the path. This avoids cross-origin browser requests during local development. Both the Vite development server and local preview use this proxy.

The backend needs `DEEPSEEK_API_KEY` for classification; use the command above to load `backend/.env`. The frontend needs no environment file for the defaults. To use another backend port or host:

```sh
cd frontend
cp .env.example .env
```

Set `API_PROXY_TARGET` in `frontend/.env` to the backend origin, such as `http://127.0.0.1:8001`, and restart Vite. The variable is server-side Vite configuration. The backend automatically loads `backend/.env` on startup using python-dotenv, regardless of the working directory. Existing environment variables take precedence; a missing `.env` is allowed. Restart the backend after changing it.

Never commit secrets. Local `.env` files are ignored; sanitized `.env.example` files may be committed. Any future `VITE_*` variable is exposed in browser bundles and must not contain secrets.

## Development and verification

Run backend commands from `backend/`:

```sh
uv run python -m unittest discover -s tests -v
```

Run frontend commands from `frontend/`:

```sh
npm run lint
npm run typecheck
npm run build
npm run preview
```

Lint uses Oxlint. Typecheck uses TypeScript strict mode; build also runs TypeScript before bundling. The production build is written to `frontend/dist/`. Preview serves that build at http://localhost:4173 and requires the backend for API calls. Preview is for local verification, not production hosting. No frontend automated test runner is configured yet.

For an integration smoke check, start both services and run:

```sh
curl --fail http://127.0.0.1:8000/api/v1/health
curl --fail http://localhost:5173/api/v1/health
```

Both should return the same health response. In the browser, classify the example with DeepSeek, confirm any required review decision, and export the report. Stop the backend and classify again to verify visible failure and retry behavior.

Add backend dependencies with `uv add <package>` or `uv add --dev <package>`. Add frontend dependencies with `npm install <package>` or `npm install -D <package>`. Commit the corresponding manifest and lockfile together. Use `uv sync --locked` and `npm ci` for reproducible installs.

## Extending the project

- Add backend routers under `backend/app/api/` and register them in `app/main.py`. Add schemas, services, and persistence modules when needed.
- Centralize frontend API calls in `frontend/src/lib/api.ts`. Add reusable components, feature folders, or hooks as features emerge.
- Coordinate request and response changes across both applications and add meaningful behavior tests.
- Coding agents should read the [shared engineering standards](AGENTS.md) and the appropriate [backend guide](backend/AGENTS.md) or [frontend guide](frontend/AGENTS.md) before editing that application.

## Deployment considerations

Build the frontend with `npm ci && npm run build` and serve `frontend/dist/` using a static host or web server. Start the backend with `uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000` without `--reload` in an appropriate managed environment.

The Vite proxy is not included in the static build. Configure the production reverse proxy to forward `/api/*` to FastAPI, preserving the path, and serve frontend assets on the same origin. If client-side routing is introduced, configure an HTML fallback for frontend routes. If a separate API origin is chosen instead, update the frontend API base URL and configure explicit FastAPI CORS origins. TLS, authentication, secrets, process management, and infrastructure must be configured for the deployment environment.

## Troubleshooting

- **API unavailable:** confirm the backend is running, check `/api/v1/health` directly, and check `API_PROXY_TARGET`. Restart Vite after changing its environment file.
- **Port in use:** stop the existing process or choose another port. Vite uses strict ports to avoid silently changing the frontend URL. Changing the backend port also requires changing the proxy target.
- **Unsupported Node engine:** switch to a Node version satisfying the prerequisites, then run `npm ci` again.
- **Python import error:** run backend commands from `backend/` after `uv sync --locked`.

## Framework references

- [FastAPI application structure](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
- [Vite getting started](https://vite.dev/guide/)
- [React documentation](https://react.dev/)

## Classification API and DeepSeek setup

From `backend/`, copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY`. Then launch:

```sh
uv run python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`DEEPSEEK_BASE_URL` defaults to `https://api.deepseek.com`; `DEEPSEEK_MODEL` defaults to the POC's `deepseek-flash`. Keys stay on the server. Only email text and attachment filename metadata are transmitted; attachment contents are not sent to the classifier. The inbox UI can retrieve them separately. The model treats email contents as untrusted data. Outbound calls have 60-second timeouts and at most three attempts per classification/audit, with bounded backoff; non-transient HTTP errors are not retried.

`POST /api/v1/classify` accepts:

```json
{
  "email": {
    "email_id": "demo_001",
    "from": "operations@example.com",
    "subject": "Check draft BL",
    "body": "Please compare the draft BL against the SI.",
    "attachments": ["demo_001_SI.txt", "demo_001_BL.txt"]
  }
}
```

Classification always uses DeepSeek-only. The request contains only `email`; `mode` is absent from both request and response. Obsolete `mode` fields are rejected with HTTP 422. Returns `classification`, optional `audit`, `audit_risk_flags`, and `next_step`. Next steps are `human_review`, `document_comparison_pending`, or `classification_complete`. Ambiguous or insufficient evidence and audit disagreement require review; the initial prediction is preserved with the competing category. A failed audit fails the request rather than returning an unaudited decision. HTTP 422 means invalid input, 503 missing server configuration, and 502 provider failure or invalid output.

The export includes original email context, model evidence, human decision and note, effective category, and updated next step. Pipeline exports also include local BL/SI extraction results when available. It is not a completed discrepancy submission. Do not expose the unauthenticated demo API publicly without authentication and rate limits.

## Offline batch evaluation

The POC's resumable runner and metrics are available inside this project. Dataset and answer key are supplied explicitly, keeping ground truth separate from the classifier. From `backend/`:

```sh
uv run python -m app.services.classification.evaluate \
  --dataset ../../sdoc-hackathon-bundle \
  --ground-truth ../../sdoc-hackathon-docker/data_v2/ground_truth.json \
  --fresh
```

The runner uses DeepSeek-only; there are no alternative method flags. The runner explicitly loads `backend/.env` (override with `--env-file`), defaults to four workers, checkpoints completed predictions, and retries failed emails on the next run. Use `--max-emails 5` for a smoke test. Outputs are ignored under `backend/output/classification/`. Model metrics exclude unresolved review cases and report automatic coverage. Comparison fields in the compatibility submission are placeholders, with comparison cases marked for review: evaluate classification only until comparison and reporting are implemented.

The source POC and its existing evaluation outputs are unchanged. Regression tests use fake model clients and never send emails to a live provider.

## Selected method and recorded accuracy

DeepSeek-only (`deepseek-flash`) was selected from the source POC evaluation: all 520 saved predictions match the supplied ground truth, accuracy and macro-F1 are 1.0, and zero cases were excluded for human review. This is the recorded dataset result, not a guarantee for future emails or a new live evaluation. Ground truth is used only for evaluation and is never passed to the classification model. Hybrid and local-rule classifiers have been removed from this project.

Numeric model confidence has been removed from prompts, API responses, the UI, and exports. Human review relies on explicit ambiguity flags and second-pass audit findings. The 520/520 result above belongs to the original saved POC run; the revised prompt without confidence has not been evaluated live. Use `--fresh` for the new evaluation version.

## Pipeline workspace and Debug mode

The main page presents the full **Classify → Extract → Compare → Report** workflow. Classification and extraction are implemented. Confirmed `BL_COMPARISON` requests automatically retrieve and extract their BL and SI documents; review decisions can also trigger extraction. Counts reflect the current session, and extracted requests pause before comparison. The queue supports subject/ID search, human-review filtering, retries, and pagination (20 emails per page).

Use **Debug mode** in the sidebar to test stages independently. Its classification workspace uses the same API with separate input, results, review decisions, and export files; debug runs never alter the main pipeline queue. Raw API responses are available in each debug result. Extraction Debug runs independently as described below. Comparison and report test benches remain disabled until their endpoints are implemented. Navigation preserves session state and supports browser back/forward; refreshing clears it.

The interface follows the locally installed `ui-ux-pro-max` skill: a responsive operations console with blue actions, a navy sidebar, explicit stage statuses, keyboard focus, and reduced-motion support. Project-specific design rules are recorded in [AGENTS.md](AGENTS.md#product-ui-design).

## Docker inbox source

Start the inbox service from `../sdoc-hackathon-docker/` with `docker compose up --build`.
The backend reads its public HTTP API at `http://127.0.0.1:8080`; override
`INBOX_BASE_URL` in `backend/.env` which is loaded automatically at backend startup.
If the backend also runs in a container, use an origin reachable from that container.

In Pipeline, choose **Request emails from Docker**, select an email, then **Load email
and attachments**. Loading retrieves the current email and every listed attachment
before making that email available for classification. Retrieved attachments can be
downloaded and plain-text attachments inspected. Run classification after loading.
Debug offers the same picker with an optional attachment checkbox, alongside manual
JSON and file inputs. Each workspace retains its own session.

The backend exposes `GET /api/v1/inbox/emails`, `GET /api/v1/inbox/emails/{email_id}`,
and `GET /api/v1/inbox/emails/{email_id}/attachments/{path}`. Attachment requests
verify membership in the selected email. Requests have 20-second upstream timeouts
and a 10 MB response limit; the browser limits total attachments per email to 20 MB.
Empty inboxes, missing resources, and connection failures are shown explicitly.
Attachment bytes remain in the browser session and are not included in classification
exports or sent to DeepSeek. Pipeline and Debug extraction share the same local extraction module; comparison remains unimplemented.

## Extraction Debug

Open **Debug mode → Extraction**. Click **Request BL_COMPARISON emails**, select
an ID, and click **Request selected email**. The catalog reads only category eligibility
from the sibling `sdoc-hackathon-docker/data_v2/ground_truth.json`; set
`EXTRACTION_DEBUG_GROUND_TRUTH` to an absolute path when using another checkout or
container. Missing or invalid catalogs produce an actionable error. No ground-truth
statuses, defect flags, or defect fields are returned to the UI or used by extraction.
Only the selected eligible email is fetched from Docker; the catalog does not fetch
the entire inbox. Eligibility is checked again by the server before extraction.

Click **Run extraction test** to retrieve that email's BL and SI attachments from
Docker. The extraction module routes TXT, PDF, DOCX, and XLSX to separate readers,
then applies one shared seven-field label parser adapted from `../ExtractFrom/`.
Results show **BL on the left, SI — Source of Truth on the right**, stacking BL
above SI on narrow screens. Debug displays matching field keys in two JSON panels for
quick comparison; each panel can expand the full response with source evidence.
**Download extraction JSON** saves the complete BL and SI result together, including
source text, warnings, and errors. Extraction is local and does not use a
model or send document contents to DeepSeek. The `DEEPSEEK_*` settings remain
necessary for classification only.

The format readers follow the relevant `ExtractFrom/` implementations: TXT tries
UTF-8 and Windows encodings; DOCX includes paragraphs, tables, headers, and
footers; XLSX interprets rows as label/value pairs without evaluating formulas;
PDF reads page text layers. The shared parser normalizes label synonyms, rejects
placeholder values, converts metric tonnes to kilograms, and marks conflicting or
missing fields for review. A bare number under a gross-weight label is treated as
kilograms with an explicit review warning. Unknown labels require review. Scanned
PDFs require OCR, which is not implemented.

Limits: 10 MB per attachment, 100,000 text characters, 30 PDF pages, 25 MB
expanded Office archive content, 10,000 spreadsheet rows and 100 columns. Only
one filename-identified BL and one SI can be extracted per run; missing or
multiple candidates require review. A document whose content identifies another
type is also flagged. A failure on one side preserves the other side's result.
Stopping cancels the browser request; work already running on the server may
finish. Debug results are session-only and do not modify Pipeline or Classification Debug. Pipeline extraction results are also session-only and appear under the corresponding classified email.

- `POST /api/v1/extract` with `{"email_id":"email_001"}`: extract one Docker email for Pipeline after classification confirms `BL_COMPARISON`; no ground-truth lookup.
- `GET /api/v1/debug/extraction/emails`: eligible IDs only.
- `GET /api/v1/debug/extraction/emails/{email_id}`: selected eligible Docker email.
- `POST /api/v1/debug/extraction` with `{"email_id":"email_001"}`: fresh email plus
  independent `bl` and `si` results. Each side has `extracted`, `needs_review`, or
  `error` status. HTTP 422 rejects ineligible IDs; HTTP 503 reports a missing catalog. Document failures appear on the affected side.

Extraction is not discrepancy comparison. Review extracted values and evidence;
no match/mismatch verdict is produced by this stage.
