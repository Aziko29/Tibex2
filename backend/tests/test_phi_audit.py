"""17–19-band regressiya testlari (SQLite'da; Postgres triggerlari alohida tekshiriladi)."""
from datetime import datetime, timezone

from app.models import Appointment, LabOrder, Patient
from app.security.audit import ZERO_HASH, compute_row_hash
from app.security.crypto import EncryptedJSON, EncryptedText


def test_phi_columns_are_encrypted_types():
    assert isinstance(Patient.__table__.c.address_enc.type, EncryptedText)
    assert isinstance(Patient.__table__.c.allergies_enc.type, EncryptedJSON)
    for n in ("complaint", "prelim_dx", "final_dx"):
        assert isinstance(Appointment.__table__.c[f"{n}_enc"].type, EncryptedText)
    for n in ("service", "vitals", "prescriptions", "draft", "lab_orders"):
        assert isinstance(Appointment.__table__.c[f"{n}_enc"].type, EncryptedJSON)
    assert isinstance(LabOrder.__table__.c.result_data_enc.type, EncryptedJSON)
    # plaintext ORM atributlari o'zgarmagan
    assert hasattr(Patient, "address") and hasattr(Appointment, "final_dx")


def test_row_hash_is_deterministic_and_tamper_evident():
    t = datetime(2026, 9, 29, tzinfo=timezone.utc)
    kw = dict(id=1, user="u", role="admin", action="view", detail="patient #1",
              before=None, after=None, ip="1.2.3.4", created_at=t)
    h1 = compute_row_hash(ZERO_HASH, **kw)
    assert h1 == compute_row_hash(ZERO_HASH, **kw)
    assert h1 != compute_row_hash(ZERO_HASH, **{**kw, "detail": "patient #2"})
    assert h1 != compute_row_hash("1" * 64, **kw)
