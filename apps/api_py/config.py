import os
import pathlib
from dotenv import load_dotenv

# Load root .env (two levels up from apps/api_py)
_here = pathlib.Path(__file__).resolve().parent
_root_env = _here.parent.parent / ".env"
load_dotenv(dotenv_path=_root_env)
load_dotenv()  # also pick up a local .env if present

REPO_ROOT = str(_here.parent.parent)


def _required(name: str, fallback: str | None = None) -> str:
    value = os.environ.get(name, fallback)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _db_path() -> str:
    raw = os.environ.get("DATABASE_FILE", "./data/cpwork.db")
    if os.path.isabs(raw):
        return raw
    return str(pathlib.Path(REPO_ROOT) / raw)


ENV = os.environ.get("NODE_ENV", "development")
PORT = int(os.environ.get("API_PORT", "3000"))
WEB_ORIGIN = os.environ.get("WEB_ORIGIN", "http://localhost:5173")
DATABASE_FILE = _db_path()
JWT_SECRET = _required("JWT_SECRET", "dev-insecure-secret-change-me")
JWT_EXPIRES_IN = os.environ.get("JWT_EXPIRES_IN", "8h")
BCRYPT_ROUNDS = int(os.environ.get("BCRYPT_ROUNDS", "12"))
MASTER_KEY = os.environ.get("CPWORK_MASTER_KEY", "0" * 64)

SEED_ADMIN_USERNAME = os.environ.get("SEED_ADMIN_USERNAME", "admin")
SEED_ADMIN_PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD", "ChangeMe123!")
SEED_ADMIN_NAME = os.environ.get("SEED_ADMIN_NAME", "Administrator")

IS_PROD = ENV == "production"
