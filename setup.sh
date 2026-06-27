#!/usr/bin/env bash
# =============================================================================
# CPWork Setup Script
# Sets up the Python backend + Node.js frontend for the CPWork platform.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[setup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn] ${NC} $*"; }
error()   { echo -e "${RED}[error]${NC} $*" >&2; }

echo ""
echo "============================================="
echo "  CPWork Setup"
echo "============================================="
echo ""

# ---------------------------------------------------------------------------
# 1. Python check
# ---------------------------------------------------------------------------
info "Checking Python..."
if ! command -v python3 &>/dev/null; then
  error "python3 not found. Please install Python 3.10+ and re-run this script."
  exit 1
fi

PYTHON_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJ=$(echo "$PYTHON_VER" | cut -d. -f1)
PYTHON_MIN=$(echo "$PYTHON_VER" | cut -d. -f2)

if [ "$PYTHON_MAJ" -lt 3 ] || { [ "$PYTHON_MAJ" -eq 3 ] && [ "$PYTHON_MIN" -lt 10 ]; }; then
  error "Python 3.10+ required (found $PYTHON_VER)."
  exit 1
fi
info "Python $PYTHON_VER — OK"

# ---------------------------------------------------------------------------
# 2. Virtual environment
# ---------------------------------------------------------------------------
if [ ! -d ".venv" ]; then
  info "Creating Python virtual environment (.venv)..."
  python3 -m venv .venv
else
  info "Virtual environment (.venv) already exists — skipping creation."
fi

# Activate venv
# shellcheck disable=SC1091
source .venv/bin/activate
info "Virtual environment activated."

# ---------------------------------------------------------------------------
# 3. Python dependencies
# ---------------------------------------------------------------------------
info "Installing Python dependencies from apps/api_py/requirements.txt..."
pip install --quiet --upgrade pip
pip install --quiet -r apps/api_py/requirements.txt
info "Python dependencies installed."

# ---------------------------------------------------------------------------
# 4. Node.js check + npm install + Playwright Chromium
# ---------------------------------------------------------------------------
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  info "Node.js $NODE_VER — OK"
  info "Installing npm dependencies..."
  npm install
  info "npm dependencies installed."
  info "Installing Playwright Chromium (visual smoke / QA screenshots)..."
  npx playwright install chromium
  info "Playwright Chromium installed."
  info "Building shared package..."
  npm run build:shared --silent
  info "Shared package built."
else
  warn "node not found — frontend will not be available. Install Node.js >= 20 to run the web UI."
fi

# ---------------------------------------------------------------------------
# 5. .env setup
# ---------------------------------------------------------------------------
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env created from .env.example"
    warn "IMPORTANT: Edit .env and set JWT_SECRET and CPWORK_MASTER_KEY to real secrets before starting!"
    warn "  Generate secrets:  openssl rand -hex 32  (run twice, once for each key)"
  else
    warn ".env.example not found — please create .env manually."
  fi
else
  info ".env already exists — skipping."
fi

# ---------------------------------------------------------------------------
# 6. Data directory
# ---------------------------------------------------------------------------
mkdir -p data
info "data/ directory ready."

# ---------------------------------------------------------------------------
# 7. Seed admin user
# ---------------------------------------------------------------------------
info "Seeding admin user..."
python3 apps/api_py/scripts/seed_admin.py
info "Seed complete."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================="
echo "  Setup complete!"
echo "============================================="
echo ""
echo "  Start everything:"
echo "    npm run dev"
echo ""
echo "  Or start components separately:"
echo "    Python API:  source .venv/bin/activate && python3 apps/api_py/main.py"
echo "    Frontend:    npm run dev:web"
echo ""
echo "  API runs on:  http://localhost:3000"
echo "  Web runs on:  http://localhost:5173"
echo ""
