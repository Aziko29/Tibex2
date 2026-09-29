"""P0-3: role permission change publishes session.revoked for every active jti."""
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
async def test_role_permission_change_publishes_all_jtis(monkeypatch):
    from app.routers import roles

    published: list[str] = []

    async def fake_publish(jti: str) -> None:
        published.append(jti)

    async def noop_async(*a, **k) -> None:
        return None

    monkeypatch.setattr(roles, "publish_session_revoked", fake_publish)
    monkeypatch.setattr(roles, "log_action", noop_async)
    monkeypatch.setattr(roles, "publish", noop_async)
    monkeypatch.setattr(roles, "client_ip", lambda request: "127.0.0.1")

    class _Res:
        def __init__(self, items=None, one=None):
            self._items, self._one = items or [], one

        def scalars(self):
            return SimpleNamespace(all=lambda: list(self._items))

        def scalar_one_or_none(self):
            return self._one

    class _DB:
        async def execute(self, q):
            s = str(q)
            if "FROM roles" in s:
                return _Res(one=SimpleNamespace(
                    id=5, key="doctor", name="Shifokor", icon="👤", color="lab",
                    description="", permissions=["patients.view"],
                    active=True, system=False,
                ))
            if "FROM users" in s:
                return _Res(items=[SimpleNamespace(id=10), SimpleNamespace(id=11)])
            if "sessions.jti" in s:
                return _Res(items=["jti-a", "jti-b", "jti-c"])
            if "FROM sessions" in s:  # DELETE
                return _Res(items=[])
            return _Res()

        async def flush(self):
            pass

        async def commit(self):
            pass

    body = roles.RolePatch(permissions=["patients.view", "patients.create"])
    actor = SimpleNamespace(id=1, fullname="Admin", role_key="superadmin")
    perm = SimpleNamespace(permissions="*")
    req = SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1"), headers={},
        url=SimpleNamespace(path="/api/roles/5"),
    )

    await roles.update_role(5, body, req, _DB(), actor, perm)

    assert sorted(published) == ["jti-a", "jti-b", "jti-c"]
