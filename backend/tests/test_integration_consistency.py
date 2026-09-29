"""Integratsiya/sinxronlik testi: konfiguratsiya, deploy fayllari, frontend va migratsiyalar.

Hech qanday DB/Redis/tarmoq talab qilmaydi: faqat fayllarni statik o'qiydi.
Maqsad — bir joyda o'zgargan nom boshqa joyda qolib ketmasligi (masalan,
`.env.example` dagi noto'g'ri o'zgaruvchi nomi jimgina e'tiborsiz qolishi).
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
FRONTEND = ROOT / "frontend"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _settings_fields() -> set[str]:
    tree = ast.parse(_read(BACKEND / "app" / "config.py"))
    fields: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "Settings":
            for item in node.body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    fields.add(item.target.id)
    return fields


def _valid_env_names() -> set[str]:
    names = {f"TIBEX_{f.upper()}" for f in _settings_fields()}
    return names | {f"{n}_FILE" for n in names}


def test_env_names_match_settings_fields():
    valid = _valid_env_names()
    for rel in (".env.example", "docker-compose.yml", "docker-entrypoint.sh", "setup.py",
                "deploy/tibex.service"):
        used = set(re.findall(r"\bTIBEX_[A-Z0-9_]+", _read(BACKEND / rel)))
        unknown = sorted(n for n in used if n not in valid)
        assert not unknown, f"{rel}: Settings'da yo'q o'zgaruvchilar: {unknown}"


def test_cookie_domain_not_configured_for_host_prefix():
    # __Host- cookie domain atributini taqiqlaydi (14-band)
    assert "TIBEX_COOKIE_DOMAIN" not in _read(BACKEND / ".env.example")


def test_compose_secrets_entrypoint_setup_are_in_sync():
    compose = _read(BACKEND / "docker-compose.yml")
    entry = _read(BACKEND / "docker-entrypoint.sh")
    setup = _read(BACKEND / "setup.py")

    defined = dict(re.findall(r"^  (tibex_\w+):\n    file: \./secrets/([\w.\-]+)$", compose, re.M))
    assert defined, "compose 'secrets:' bo'limi topilmadi"

    backend_block = compose.split("  backend:", 1)[1].split("\nvolumes:", 1)[0]
    used_by_backend = set(re.findall(r"^      - (tibex_\w+)$", backend_block, re.M))
    assert used_by_backend <= set(defined), used_by_backend - set(defined)

    copied = set(re.findall(r"/run/secrets/(tibex_\w+)", entry))
    assert copied == used_by_backend, (
        f"entrypoint nusxalagan va backend'ga ulangan sirlar farq qiladi: {copied ^ used_by_backend}"
    )

    setup_files = set(re.findall(r'"([\w.\-]+\.(?:txt|json|conf))"', setup.split("SECRET_FILES", 1)[1].split(")", 1)[0]))
    assert setup_files == set(defined.values()), setup_files ^ set(defined.values())


def test_redis_image_and_privilege_drop_tool_match():
    compose = _read(BACKEND / "docker-compose.yml")
    if "redis:7-alpine" in compose:
        assert "gosu" not in compose, "redis:7-alpine da gosu yo'q (su-exec ishlating)"
    if "su-exec" in compose:
        assert "alpine" in compose


def test_dockerfile_installs_gosu_used_by_entrypoint():
    assert "gosu" in _read(BACKEND / "docker-entrypoint.sh")
    assert re.search(r"apt-get install[^\n]*\n?[^\n]*gosu", _read(BACKEND / "Dockerfile"))


def test_html_pages_reference_existing_assets_and_safe_js_first():
    pages = sorted(FRONTEND.glob("*.html"))
    assert pages
    for page in pages:
        html = _read(page)
        srcs = re.findall(r'<script[^>]*\bsrc="([^"]+)"', html)
        links = re.findall(r'<link[^>]*\bhref="([^"]+)"', html)
        for ref in srcs + links:
            if ref.startswith(("http", "data:", "#")):
                continue
            assert (FRONTEND / ref.split("?")[0].lstrip("/")).exists(), f"{page.name}: {ref} yo'q"
        local = [s for s in srcs if s.startswith("static/")]
        assert local and "tibex-safe" in local[0], f"{page.name}: tibex-safe.js birinchi emas"
        assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", html), f"{page.name}: inline <script>"
        assert not re.search(r"\son(click|change|submit|load|error|input)=", html), f"{page.name}: inline handler"


def test_frontend_does_not_call_removed_audit_clear():
    for path in (FRONTEND / "static").rglob("*.js"):
        if "vendor" in path.parts:
            continue
        assert "/api/audit/clear" not in _read(path), f"{path.name}: 410 qaytaradigan endpoint"


def test_payment_client_sends_idempotency_key():
    assert "Idempotency-Key" in _read(FRONTEND / "static" / "tibex-client.js")


def test_alembic_single_linear_head_with_downgrades():
    revisions: dict[str, str | None] = {}
    for path in (BACKEND / "alembic" / "versions").glob("*.py"):
        src = _read(path)
        rev = re.search(r"^revision\s*(?::[^=]+)?=\s*['\"]([^'\"]+)", src, re.M)
        down = re.search(r"^down_revision\s*(?::[^=]+)?=\s*(.+)$", src, re.M)
        assert rev and down, path.name
        assert "def downgrade" in src, f"{path.name}: downgrade() yo'q"
        value = down.group(1).strip().strip("'\"")
        revisions[rev.group(1)] = None if value == "None" else value
    parents = {v for v in revisions.values() if v}
    heads = set(revisions) - parents
    assert len(heads) == 1, f"bir nechta head: {heads}"
    assert parents <= set(revisions), "mavjud bo'lmagan down_revision"
    assert sum(1 for v in revisions.values() if v is None) == 1, "bitta root bo'lishi kerak"
