#!/usr/bin/env bash
# Start CPWork API + web UI in a single terminal.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[start]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn] ${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; }

if [ ! -d ".venv" ]; then
  error "Python virtual environment not found. Run ./setup.sh first."
  exit 1
fi

if [ ! -f ".env" ]; then
  warn ".env not found — run ./setup.sh or copy .env.example to .env"
fi

if [ ! -d "node_modules" ]; then
  error "node_modules not found. Run npm install or ./setup.sh first."
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

info "Building shared package..."
npm run build:shared --silent

echo ""
echo "============================================="
echo "  CPWork — API + Web (single terminal)"
echo "============================================="
echo "  API:  http://localhost:3000"
echo "  Web:  http://localhost:5173"
echo "  Press Ctrl+C to stop both services"
echo "============================================="
echo ""

cleanup() {
  info "Stopping services..."
  jobs -p | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python3 apps/api_py/main.py &
API_PID=$!

npm run dev --workspace @cpwork/web &
WEB_PID=$!

wait -n "$API_PID" "$WEB_PID" 2>/dev/null || wait
