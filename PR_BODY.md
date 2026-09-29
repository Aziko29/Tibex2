# gap-closure → prod-hardening

One commit per task (`gap-P0-1` … `gap-P2-4`, `gap-GATE`). File → verification table: `CHANGES.md`, section "Gap-closure sprint".
Legend: **[x]** verified in the authoring sandbox; **[ ]** NOT verified there (no network / no Postgres / deps missing) — run the command shown before merging.

## Definition of Done

### Build & tests
- [ ] `python -m pyflakes backend/app backend/scripts` → 0  — pyflakes not installable in sandbox. Substitute AST unused-import check on the 9 touched `.py` files: clean after fixing `ws.py` F401 (`REVOKED`). Run the real tool.
- [ ] `pytest -q backend/tests` → all green; count ≥ baseline + new — not run (deps missing). Test functions: baseline 96 → now 104 (+8: roles_ws_revoke 1, rbac_matrix 1 parametrized ×133, crypto dedupe 3, audit throttle 3). DB-less tests must pass; RBAC needs `TEST_DATABASE_URL`.
- [ ] `node --test frontend/tests/xss.spec.js` → green — needs `jsdom` (`cd frontend && npm ci && npm test`). `tests/snapshot-hash.spec.js` **5/5 pass** (**[x]**, no jsdom needed).
- [ ] `alembic upgrade head && alembic downgrade base && alembic upgrade head` on empty DB → clean — no Postgres. Static check **[x]**: 11 revisions, single head `int20260929_1200`, single root, no dangling `down_revision`.

### Artifacts
- [x] 5 new unit files present under `backend/deploy/` (cleanup .service/.timer, restore-drill .service/.timer, tibex-logrotate)
- [ ] `backend/.secrets.baseline` present; `detect-secrets scan --baseline` → no findings — **file is missing** (no network). Generate with the P0-2 command in an environment with `detect-secrets==1.5.0`; if it reports a real secret, STOP and report (path + type only). Quick regex grep found no real secrets (only the placeholder token in `TELEGRAM_SETUP.md`).
- [ ] `pytest backend/tests/test_rbac_matrix.py` → 133 green — needs Postgres test DB.
- [x] `CHANGES.md` innerHTML table: 141 rows, zero empty `action` / `verified-by` cells

### Behaviour
- [ ] Role permission change → WS closed < 1 s (`test_roles_ws_revoke.py` green) — test written, not run here.
- [x] `systemd-analyze verify` on both services → exit 0 (host-specific paths/user stubbed for the check; `logrotate -d` **not run**, logrotate not installed)

### Docs
- [x] `docs/OPERATIONS.md` — install block for the 5 units
- [x] `backend/docs/SECURITY.md` — fullname `STATUS: AWAITING DECISION (owner: <name>, opened: 2026-09-29)` — **owner still `<name>`, fill in**
- [x] `CHANGES.md` — one row per task, format file → verification

### Handoff
- [x] One commit per task; prefixes `gap-P0-N:`, `gap-P1-N:`, `gap-P2-N:`
- [ ] Branch pushed; PR opened against `prod-hardening` with this checklist as the body — push/PR must be done by a human.

## Deviations from the spec (review these)
- **P2-3:** spec named `backend/app/realtime.py` and `repr(obj)[:4096]`. `_changedSnapshotEntities` is JavaScript in `frontend/static/tibex-client.js`; truncating to 4096 chars would miss changes in large lists (proved by a test). Implemented FNV-1a over the full `JSON.stringify` string + length.
- **P2-1:** `_ws_session_scope()` also commits on clean exit (via `get_db`); old `async for` loop leaked the generator on early return.
- **P0-1:** `tibex-cleanup.service` `ReadWritePaths` got a leading `-` (optional path) — nobody creates `/opt/tibex/backend/backups`, and a missing path fails the unit at startup.
- **OPEN (decision needed):** `tibex-restore-drill.service` runs as `User=tibex` but reads `/root/tibex-backup-key.txt` and `/var/backups/tibex` (0700). Align user/paths before enabling the timer.
- **GATE:** no code for `Patient.fullname` — docs status only.
