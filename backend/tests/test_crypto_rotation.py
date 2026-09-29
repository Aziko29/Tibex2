"""Kalit rotatsiyasi va `scripts/reencrypt.py` (SQLite test bazada)."""
import base64
import os
import sqlite3
from types import SimpleNamespace

import pytest

pytest.importorskip("aiosqlite")


def _token(key: bytes, key_id: str, plaintext: str, context: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode(), f"{key_id}|{context}".encode())
    return f"{key_id}:" + base64.b64encode(nonce + ct).decode()


@pytest.fixture
def ring(monkeypatch):
    from app.security.crypto import _ring

    old, new = b"o" * 32, b"n" * 32
    monkeypatch.setattr(_ring, "_keys", {"1": old, "2": new})
    monkeypatch.setattr(_ring, "active_id", "2")
    return _ring, old, new


@pytest.mark.asyncio
async def test_reencrypt_moves_old_records_to_active_key_and_is_idempotent(monkeypatch, tmp_path, ring):
    from sqlalchemy import Column, Integer, MetaData, Table

    from app.security.crypto import EncryptedString
    from scripts import reencrypt

    _ring, old, _new = ring
    ctx = "t.secret"
    db_path = tmp_path / "t.db"
    con = sqlite3.connect(db_path)
    con.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, secret TEXT)')
    con.executemany("INSERT INTO t (id, secret) VALUES (?, ?)", [
        (1, _token(old, "1", "birinchi", ctx)),
        (2, _token(old, "1", "ikkinchi", ctx)),
        (3, None),
    ])
    con.commit()
    con.close()

    table = Table("t", MetaData(), Column("id", Integer, primary_key=True),
                  Column("secret", EncryptedString(context=ctx)))
    monkeypatch.setattr(
        reencrypt, "encrypted_columns",
        lambda: iter([(table, table.c.id, table.c.secret)]),
    )
    monkeypatch.setattr(
        reencrypt, "get_settings",
        lambda: SimpleNamespace(database_url=f"sqlite+aiosqlite:///{db_path}"),
    )

    def tokens():
        c = sqlite3.connect(db_path)
        try:
            return [r[0] for r in c.execute("SELECT secret FROM t ORDER BY id")]
        finally:
            c.close()

    before = tokens()
    assert await reencrypt.run(dry_run=True, batch_size=1) == 2
    assert tokens() == before  # dry-run yozmaydi

    assert await reencrypt.run(dry_run=False, batch_size=1) == 2
    after = tokens()
    assert after[0].startswith("2:") and after[1].startswith("2:") and after[2] is None
    assert _ring.decrypt(after[0], ctx) == "birinchi"
    assert _ring.decrypt(after[1], ctx) == "ikkinchi"

    assert await reencrypt.run(dry_run=False, batch_size=500) == 0  # idempotent


def test_unknown_key_id_raises_and_never_returns_placeholder(ring):
    from app.security.crypto import DecryptionError, EncryptedString

    _ring, _old, _new = ring
    with pytest.raises(DecryptionError):
        _ring.decrypt("99:" + base64.b64encode(b"x" * 40).decode(), "ctx")
    with pytest.raises(DecryptionError):
        EncryptedString(context="ctx").process_result_value("99:" + base64.b64encode(b"x" * 40).decode(), None)
