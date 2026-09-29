"""Session cookie attributes shared by staff and patient authentication."""
from fastapi import Response

COOKIE_NAME = "__Host-cf_session"
COOKIE_PATH = "/"
COOKIE_SECURE = True


def set_session_cookie(response: Response, token: str, max_age: int, same_site: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=max_age,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=same_site,
        path=COOKIE_PATH,
    )


def clear_session_cookie(response: Response, same_site: str) -> None:
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
        samesite=same_site,
        secure=COOKIE_SECURE,
    )
