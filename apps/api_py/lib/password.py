import re
import bcrypt
import config as cfg


def hash_password(plaintext: str) -> str:
    rounds = cfg.BCRYPT_ROUNDS
    salt = bcrypt.gensalt(rounds=rounds)
    return bcrypt.hashpw(plaintext.encode("utf-8"), salt).decode("utf-8")


def verify_password(plaintext: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plaintext.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def validate_password_strength(password: str) -> str | None:
    """Returns an error message or None if valid."""
    if len(password) < 10:
        return "Password must be at least 10 characters"
    if not re.search(r"[A-Z]", password):
        return "Password must contain at least one uppercase letter"
    if not re.search(r"[0-9]", password):
        return "Password must contain at least one digit"
    return None
