"""Startup loads local configuration without replacing deployment settings."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class StartupTests(unittest.TestCase):
    def test_loads_env_and_preserves_existing_values(self):
        with TemporaryDirectory() as directory:
            env_file = Path(directory) / '.env'
            env_file.write_text('STARTUP_LOCAL="value with spaces"\nSTARTUP_EXISTING=local\n')
            with patch('app.main.ENV_FILE', env_file), patch.dict(os.environ, {'STARTUP_EXISTING': 'deployment'}, clear=True):
                with TestClient(app) as client:
                    self.assertEqual(client.get('/api/v1/health').status_code, 200)
                    self.assertEqual(os.environ['STARTUP_LOCAL'], 'value with spaces')
                    self.assertEqual(os.environ['STARTUP_EXISTING'], 'deployment')

    def test_missing_env_is_optional(self):
        with TemporaryDirectory() as directory:
            with patch('app.main.ENV_FILE', Path(directory) / '.env'):
                with TestClient(app) as client:
                    self.assertEqual(client.get('/api/v1/health').status_code, 200)
