"""ASGI entry point: python -m uvicorn app.main:app."""

from contextlib import asynccontextmanager
import os
from pathlib import Path
from collections.abc import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.classification import router as classification_router
from app.api.comparison import router as comparison_router

from app.api.extraction import router as extraction_router, pipeline_router as pipeline_extraction_router
from app.api.inbox import router as inbox_router

ENV_FILE = Path(__file__).resolve().parents[1] / '.env'


def environment_flag(name: str, default: bool) -> bool:
    """Read a conventional boolean environment variable without ambiguity."""
    return os.environ.get(name, str(default)).strip().lower() in {'1', 'true', 'yes', 'on'}


# Debug extraction depends on organizer-only catalog data and is not intended
# for public production deployments. The Docker image explicitly turns it off.
DEBUG_ENABLED = environment_flag('ENABLE_DEBUG', True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Resolve from the backend directory, regardless of the launch directory.
    # Deployment environment variables take precedence over local defaults.
    load_dotenv(ENV_FILE, override=False)
    yield


app = FastAPI(title="PromptTroopersHack API", version="0.1.0", lifespan=lifespan)
app.include_router(health_router, prefix="/api/v1")
app.include_router(classification_router, prefix="/api/v1")
app.include_router(inbox_router, prefix="/api/v1")
if DEBUG_ENABLED:
    app.include_router(extraction_router, prefix="/api/v1")
app.include_router(pipeline_extraction_router, prefix="/api/v1")
app.include_router(comparison_router, prefix="/api/v1")
