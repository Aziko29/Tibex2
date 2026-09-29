"""Circuit Breaker — sekin/buzilgan resurslarni vaqtincha uzib turadi.

Xususiyatlar:
  • Har bir resurs uchun alohida holat (DB, Redis, HTTP)
  • 3 xil holat: closed (normal), open (bloklangan), half-open (sinov)
  • Xato bo'lsa — tez fail qiladi (timeout kutmasdan)
  • O'zi tuzaladi (30s dan keyin half-open)
"""
import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

from fastapi import HTTPException, status


@dataclass
class _CircuitState:
    """Bitta resurs uchun holat."""
    failures: int = 0
    successes: int = 0
    last_failure: float = 0.0
    opened_at: float = 0.0
    state: str = "closed"  # closed | open | half-open
    # Recent history (bounded)
    history: deque = field(default_factory=lambda: deque(maxlen=100))


class CircuitBreaker:
    """Har bir resurs uchun circuit breaker."""
    
    # Konfiguratsiya
    FAILURE_THRESHOLD = 5      # Nechta xatodan keyin ochiladi
    SUCCESS_THRESHOLD = 2      # Nechta muvaffaqiyatdan keyin yopiladi
    TIMEOUT_SECONDS = 30.0     # Qancha vaqt ochiq turadi
    OP_TIMEOUT = 5.0           # Har bir operatsiya timeout
    
    def __init__(self):
        self._states: dict[str, _CircuitState] = {}
        self._lock = asyncio.Lock()
    
    def _get(self, name: str) -> _CircuitState:
        if name not in self._states:
            self._states[name] = _CircuitState()
        return self._states[name]
    
    async def call(
        self,
        name: str,
        func: Callable[[], Coroutine],
        timeout: float | None = None,
    ) -> Any:
        """Funksiyani circuit breaker orqali chaqirish."""
        s = self._get(name)
        now = time.time()
        
        # ─── State tekshiruvi ───
        if s.state == "open":
            # Timeout o'tganmi?
            if now - s.opened_at > self.TIMEOUT_SECONDS:
                s.state = "half-open"
                s.successes = 0
            else:
                # Hali ham ochiq — tezda fail qil
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"{name} vaqtincha mavjud emas. Keyinroq urinib ko'ring.",
                )
        
        # ─── Operatsiyani bajarish ───
        op_timeout = timeout or self.OP_TIMEOUT
        try:
            result = await asyncio.wait_for(func(), timeout=op_timeout)
            # Muvaffaqiyat
            s.successes += 1
            s.failures = 0
            s.history.append(("ok", now))
            
            if s.state == "half-open" and s.successes >= self.SUCCESS_THRESHOLD:
                s.state = "closed"
                s.successes = 0
            
            return result
        
        except asyncio.TimeoutError:
            self._record_failure(s, now, "timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"{name} sekin javob bermoqda. Keyinroq urinib ko'ring.",
            )
        
        except HTTPException:
            # Bu HTTPException — bizning xato, o'tkazib yuboramiz
            raise
        
        except Exception as e:
            self._record_failure(s, now, type(e).__name__)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"{name} xatolik. Keyinroq urinib ko'ring.",
            )
    
    def _record_failure(self, s: _CircuitState, now: float, reason: str):
        s.failures += 1
        s.last_failure = now
        s.history.append((f"err:{reason}", now))
        
        if s.state == "half-open":
            # Half-open da xato — yana ochamiz
            s.state = "open"
            s.opened_at = now
        
        elif s.failures >= self.FAILURE_THRESHOLD:
            s.state = "open"
            s.opened_at = now
    
    def status(self) -> dict:
        """Barcha resurslar holati."""
        now = time.time()
        return {
            name: {
                "state": s.state,
                "failures": s.failures,
                "successes": s.successes,
                "seconds_since_failure": round(now - s.last_failure, 1) if s.last_failure else None,
                "will_retry_in": (
                    round(max(0, self.TIMEOUT_SECONDS - (now - s.opened_at)), 1)
                    if s.state == "open" else 0
                ),
            }
            for name, s in self._states.items()
        }


# Singleton
breaker = CircuitBreaker()
