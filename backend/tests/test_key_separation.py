import hmac

import pytest

from app.security.keys import PURPOSES, derive


def test_keys_distinct_and_stable():
    keys = {p: derive(p) for p in PURPOSES}
    assert len(set(keys.values())) == len(PURPOSES)
    assert all(len(k) == 32 for k in keys.values())
    assert derive("session") == keys["session"]


def test_unknown_purpose_rejected():
    with pytest.raises(ValueError):
        derive("nope")


def test_csrf_token_not_valid_as_session_sig():
    from app.security import csrf, sessions

    tok = csrf.issue_csrf("jti123")
    assert csrf.verify_csrf(tok, "jti123")
    assert not csrf.verify_csrf(tok, "other")
    assert not hmac.compare_digest(sessions._sign("x"), sessions._sign("y"))
    t, jti, _ = sessions.create_token(1, 60)
    assert sessions.parse_token(t)["jti"] == jti
