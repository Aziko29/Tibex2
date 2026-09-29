"""Patients router uchun smoke testlar."""
from fastapi.testclient import TestClient


def test_patients_requires_auth():
    from app.main import app
    client = TestClient(app)
    r = client.get("/api/patients")
    assert r.status_code == 401
