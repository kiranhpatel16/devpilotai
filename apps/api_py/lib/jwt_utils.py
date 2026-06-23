from datetime import datetime, timezone, timedelta
from jose import jwt, JWTError
import config as cfg

AUTH_COOKIE = "cpwork_token"

# Parse duration like "8h", "24h", "30m"
def _parse_expires(s: str) -> int:
    """Return seconds from a string like '8h', '30m', '1d'."""
    s = s.strip()
    if s.endswith("h"):
        return int(s[:-1]) * 3600
    if s.endswith("m"):
        return int(s[:-1]) * 60
    if s.endswith("d"):
        return int(s[:-1]) * 86400
    return 28800  # default 8h


EXPIRES_SECONDS = _parse_expires(cfg.JWT_EXPIRES_IN)


def sign_token(sub: str, username: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "username": username,
        "role": role,
        "iat": now,
        "exp": now + timedelta(seconds=EXPIRES_SECONDS),
    }
    return jwt.encode(payload, cfg.JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, cfg.JWT_SECRET, algorithms=["HS256"])
        return payload
    except JWTError:
        return None
