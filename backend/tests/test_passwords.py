"""Parol siyosati, hashlash, pepper almashtirish va DB ustuniga mosligi (DB kerak emas)."""
import base64
import hashlib

import pytest

from app.config import get_settings
from app.security import passwords as P


@pytest.mark.parametrize("pw", [
    "Strong@Pass2026", "Str0ng!Passw0rd#42", "Correct-Horse-9!", "Rbac-Test#2026-pass", "Xk9#mWq2$vLp",
])
def test_good_passwords_accepted(pw):
    assert P.check_password_strength(pw) == (True, "")


@pytest.mark.parametrize("pw", [
    "Ab1!", "Password123!", "Passw0rd#2026", "Welcome2026!", "Tibex2026!!", "Admin@12345",
    "Abcde12345!x", "Zxcvb#2026Ab", "Aaaa1111!!bB", "Ab1!Ab1!Ab1!", "NoDigits!!Aa", "A" * 300 + "b1!",
    "Abcd#1234\nxYz",
])
def test_weak_passwords_rejected(pw):
    ok, msg = P.check_password_strength(pw)
    assert not ok and msg


def test_short_message_kept_for_cli():
    assert "kamida 10" in P.check_password_strength("weak")[1]


def test_identity_in_password_rejected():
    assert not P.check_password_strength("Zafar!Bek#2026x", login="zafar_b", fullname="Zafar Bekov")[0]
    assert P.check_password_strength("Xk9#mWq2$vLp", login="zafar_b", fullname="Zafar Bekov")[0]


def test_generator_always_meets_policy():
    for _ in range(500):
        pw = P.generate_random_password()
        assert len(pw) == 16 and P.check_password_strength(pw)[0]
        assert not set(pw) & set("01lIO")
    assert len(P.generate_random_password(3)) == 12
    assert len(P.generate_random_password(10_000)) == 128


def test_hash_fits_db_column_and_verifies():
    h = P.hash_password("Xk9#mWq2$vLp")
    assert h.startswith("$argon2id$") and len(h) <= P.DB_HASH_COLUMN_LENGTH
    assert P.verify_password(h, "Xk9#mWq2$vLp") == (True, False)
    assert P.verify_password(h, "wrong") == (False, False)
    assert P.verify_password("", "x") == (False, False)
    assert P.verify_password("plain-text", "x") == (False, False)
    assert P.verify_password("$argon2id$garbage", "x") == (False, False)


def test_model_column_matches_policy_constant():
    from app.models import User
    assert User.__table__.c.password_hash.type.length == P.DB_HASH_COLUMN_LENGTH


def test_legacy_pbkdf2_verifies_and_requests_rehash():
    salt = b"saltsaltsaltsalt"
    dk = hashlib.pbkdf2_hmac("sha256", P._apply_pepper("Legacy#Pass9x"), salt, 1000)
    legacy = "$pbkdf2-sha256$1000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()
    assert P.verify_password(legacy, "Legacy#Pass9x") == (True, True)
    assert P.verify_password(legacy, "nope") == (False, False)


def test_pepper_rotation_keeps_old_hashes_working(monkeypatch):
    s = get_settings()
    old, new = "o" * 40, "n" * 40
    monkeypatch.setattr(s, "password_pepper", old)
    h_old = P.hash_password("Rotate#Me2026x")
    monkeypatch.setattr(s, "password_pepper", new)
    monkeypatch.setattr(s, "password_pepper_old", "")
    assert P.verify_password(h_old, "Rotate#Me2026x") == (False, False)
    monkeypatch.setattr(s, "password_pepper_old", f" {old} , {new}")
    assert P.verify_password(h_old, "Rotate#Me2026x") == (True, True)  # eski pepper -> rehash
    h_new = P.hash_password("Rotate#Me2026x")
    assert P.verify_password(h_new, "Rotate#Me2026x") == (True, False)
    assert P.verify_password(h_old, "bad") == (False, False)


def test_dummy_and_wrong_password_do_equal_work(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "password_pepper_old", "z" * 40)
    calls = []
    real = P._ph.verify
    monkeypatch.setattr(P._ph, "verify", lambda h, p: (calls.append(1), real(h, p))[1])
    P.verify_password(P.DUMMY_HASH, "x")
    dummy_calls, calls[:] = len(calls), []
    P.verify_password(P.hash_password("Xk9#mWq2$vLp"), "wrong")
    assert dummy_calls == len(calls) == 2
