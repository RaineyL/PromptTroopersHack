# PromptTroopersHack

Full-stack starter with a FastAPI backend and a React + TypeScript frontend built with Vite. The landing page calls the backend health endpoint and displays the connection status.

This scaffold provides local development, typed API boundaries, dependency lockfiles, and basic verification. Business features, authentication, persistence, and deployment infrastructure are not implemented yet.

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
uv run python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**

```sh
cd frontend
npm ci
npm run dev
```

Open [the frontend](http://localhost:5173). The page should show “Connected to PromptTroopersHack API.” Stop either development server with Ctrl+C.

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
        ├── App.tsx           # Starter page and connection state
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

The frontend requests `/api/v1/health` on its own origin. Vite forwards `/api/*` to `http://127.0.0.1:8000`, preserving the path. This avoids cross-origin browser requests during local development. Both the Vite development server and local preview use this proxy.

No environment file is required for the defaults. To use another backend port or host:

```sh
cd frontend
cp .env.example .env
```

Set `API_PROXY_TARGET` in `frontend/.env` to the backend origin, such as `http://127.0.0.1:8001`, and restart Vite. The variable is server-side Vite configuration. The backend currently has no required environment variables or automatic `.env` loading.

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

Both should return the same health response. In the browser, also verify the connected state; stop the backend and reload to verify the error state.

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
