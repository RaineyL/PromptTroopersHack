"""ASGI entry point: python -m uvicorn app.main:app."""

from fastapi import FastAPI

from app.api.health import router as health_router

app = FastAPI(title="PromptTroopersHack API", version="0.1.0")
app.include_router(health_router, prefix="/api/v1")
