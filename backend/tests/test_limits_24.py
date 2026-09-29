"""24-band: limit/offset chegaralari va LIKE escape."""
import inspect

from app.routers import audit, monitoring, patients, payments


def _bounds(fn, name):
    m = {type(x).__name__: x for x in inspect.signature(fn).parameters[name].default.metadata}
    return m["Ge"].ge, m["Le"].le


def test_limits_are_bounded():
    assert _bounds(patients.list_patients, "limit") == (1, 200)
    assert _bounds(patients.list_patients, "offset") == (0, 100000)
    assert _bounds(payments.list_payments, "limit") == (1, 500)
    assert _bounds(payments.list_refunds, "limit") == (1, 200)
    assert _bounds(audit.list_audit, "limit") == (1, 500)
    assert _bounds(monitoring.get_errors, "limit")[1] == 200


def test_like_escape():
    assert patients._like_escape("50%_a\\") == "50\\%\\_a\\\\"
