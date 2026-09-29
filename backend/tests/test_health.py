from fastapi.testclient import TestClient


def _client(monkeypatch, db_ok=True):
    from app import db
    from app.main import app

    class OkDB:
        async def execute(self, _q):
            return None

    async def get_db():
        if not db_ok:
            raise RuntimeError("db down")
        yield OkDB()

    monkeypatch.setattr(db, "get_db", get_db)
    return TestClient(app)


def test_health_db_down_is_503(monkeypatch):
    r = _client(monkeypatch, db_ok=False).get("/api/health")
    assert r.status_code == 503 and r.json() == {"ok": False}


def test_health_response_leaks_nothing(monkeypatch):
    r = _client(monkeypatch, db_ok=False).get("/api/health")
    assert "db down" not in r.text and "version" not in r.text.lower()
