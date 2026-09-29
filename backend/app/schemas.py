"""Umumiy Pydantic sxemalari.

Har bir router o'z sxemalarini alohida saqlaydi, lekin umumiy
sxemalar bu yerda — qayta ishlatish uchun.
"""
from typing import Any

from pydantic import BaseModel, Field


class OkResponse(BaseModel):
    ok: bool = True
    message: str = ""


class ErrorResponse(BaseModel):
    detail: str
    type: str = "error"


class Pagination(BaseModel):
    limit: int = Field(50, ge=1, le=500)
    offset: int = Field(0, ge=0)


class HealthOut(BaseModel):
    ok: bool
    db: str
    redis: str
    version: str
    env: str


class AuditOut(BaseModel):
    id: int
    user: str
    role: str
    action: str
    detail: str
    ts: int | None = None


class SystemInfoOut(BaseModel):
    version: str
    db_size_bytes: int = 0
    db_size_human: str = "0 B"
    last_backup_at: int | None = None
    clinic: dict[str, Any] = {}
