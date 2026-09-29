from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import event
from sqlalchemy.orm import DeclarativeBase, Session, with_loader_criteria

from .config import get_settings


class Base(DeclarativeBase):
    pass


@event.listens_for(Session, "do_orm_execute")
def _hide_deleted_patients(state) -> None:
    """Barcha SELECT'larga `patients.deleted_at IS NULL` qo'shadi (25-band).
    Ataylab ko'rish uchun: execution_options(include_deleted=True)."""
    if (
        state.is_select
        and not state.is_column_load
        and not state.is_relationship_load
        and not state.execution_options.get("include_deleted", False)
    ):
        from .models import Patient

        state.statement = state.statement.options(
            with_loader_criteria(Patient, Patient.deleted_at.is_(None), include_aliases=True)
        )


_engine = None
_SessionLocal: async_sessionmaker | None = None


def _init() -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        return
    s = get_settings()
    _engine = create_async_engine(
        s.database_url,
        echo=False,
        pool_size=10,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=1800,
        future=True,
    )
    _SessionLocal = async_sessionmaker(
        _engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    _init()
    assert _SessionLocal is not None
    async with _SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose() -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _SessionLocal = None
