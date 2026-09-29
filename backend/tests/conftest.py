"""Pytest konfiguratsiyasi."""
import asyncio
import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Tests must not inherit the production mode from backend/.env. Keep an
# explicitly supplied TIBEX_ENV intact so deployment-config tests can opt in.
os.environ.setdefault("TIBEX_ENV", "local")
os.environ.setdefault("TIBEX_SECRET_KEY", "test-only-secret-key-" + "s" * 40)
os.environ.setdefault("TIBEX_MASTER_KEY_B64", "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg=")
os.environ.setdefault("TIBEX_BLIND_INDEX_KEY_B64", "eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXk=")
os.environ.setdefault("TIBEX_PASSWORD_PEPPER", "test-only-password-pepper-" + "p" * 40)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
