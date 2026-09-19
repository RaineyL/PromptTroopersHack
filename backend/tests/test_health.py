"""Smoke tests for the public API contract; run with unittest discovery."""

import unittest

from fastapi.testclient import TestClient

from app.main import app


class HealthTests(unittest.TestCase):
    def test_health_contract(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/v1/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"status": "ok", "service": "PromptTroopersHack API"}
        )

    def test_health_is_documented(self) -> None:
        with TestClient(app) as client:
            response = client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/v1/health", response.json()["paths"])
