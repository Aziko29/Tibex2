import sys
from pathlib import Path

import httpx
import pytest
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from gateway import create_app  # noqa: E402

UP = "https://clinic.example.uz"


@pytest.fixture()
def env(tmp_path):
    (tmp_path / "login.html").write_text("<html><head><title>x</title></head><body>Kirish</body></html>", encoding="utf-8")
    (tmp_path / "app.js").write_text("1", encoding="utf-8")
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["req"] = req
        if req.url.path == "/api/down":
            raise httpx.ConnectError("x")
        if req.url.path == "/api/redir":
            return httpx.Response(302, headers={"location": UP + "/login.html"})
        return httpx.Response(200, json={"ok": True}, headers=[
            ("set-cookie", "sid=1; Domain=clinic.example.uz; Path=/; HttpOnly; Secure; SameSite=Lax"),
            ("set-cookie", "csrf=2; Path=/")])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    saved = []
    app = create_app(UP, tmp_path, saved.append, client)
    return TestClient(app, base_url="http://127.0.0.1:5555"), seen, saved


def test_cookie_domain_stripped_and_origin_rewritten(env):
    c, seen, _ = env
    r = c.get("/api/x", headers={"Origin": "http://127.0.0.1:5555", "Cookie": "sid=9"})
    cookies = r.headers.get_list("set-cookie")
    assert len(cookies) == 2 and all("Domain" not in x for x in cookies)
    assert "HttpOnly" in cookies[0] and "SameSite=Lax" in cookies[0]
    assert seen["req"].headers["origin"] == UP and seen["req"].headers["cookie"] == "sid=9"


def test_upstream_down_gives_503(env):
    assert env[0].get("/api/down").status_code == 503


def test_redirect_location_made_relative(env):
    r = env[0].get("/api/redir", follow_redirects=False)
    assert r.headers["location"] == "/login.html"


def test_html_gets_api_base_injected(env):
    r = env[0].get("/")
    assert r.status_code == 200 and '__API_BASE__=""' in r.text and r.text.index("<script>") < r.text.index("<title>")


def test_static_file_and_traversal(env):
    c = env[0]
    assert c.get("/app.js").status_code == 200
    assert c.get("/%2e%2e/%2e%2e/etc/passwd").status_code == 404


def test_config_needs_local_origin_and_valid_url(env):
    c, _, saved = env
    assert c.post("/__desktop/config", json={"server_url": "http://a:1"}, headers={"Origin": "http://evil.com"}).status_code == 403
    ok = {"Origin": "http://127.0.0.1:5555"}
    assert c.post("/__desktop/config", json={"server_url": "file:///x"}, headers=ok).status_code == 400
    assert c.post("/__desktop/config", json={"server_url": "http://10.0.0.5:8000/"}, headers=ok).status_code == 200
    assert saved == ["http://10.0.0.5:8000"]
