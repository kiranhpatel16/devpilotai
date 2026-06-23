#!/usr/bin/env bash
# =============================================================================
# CPWork Cache Clean Script
# Removes Python bytecode caches, Node.js build artifacts, and Vite cache.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[clean]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn] ${NC} $*"; }

echo ""
echo "============================================="
echo "  CPWork Cache Clean"
echo "============================================="
echo ""

# ---------------------------------------------------------------------------
# Python caches
# ---------------------------------------------------------------------------
info "Removing Python __pycache__ directories..."
find . -type d -name "__pycache__" \
  -not -path "./.venv/*" \
  -not -path "*/node_modules/*" \
  -exec rm -rf {} + 2>/dev/null || true

info "Removing Python .pyc / .pyo files..."
find . -type f \( -name "*.pyc" -o -name "*.pyo" \) \
  -not -path "./.venv/*" \
  -not -path "*/node_modules/*" \
  -delete 2>/dev/null || true

info "Removing pytest / mypy caches..."
rm -rf .pytest_cache .mypy_cache .ruff_cache 2>/dev/null || true

# ---------------------------------------------------------------------------
# Node.js / Vite build artifacts
# ---------------------------------------------------------------------------
info "Removing frontend dist..."
rm -rf apps/web/dist 2>/dev/null || true

info "Removing API dist (TypeScript build output)..."
rm -rf apps/api/dist 2>/dev/null || true

info "Removing shared package dist..."
rm -rf packages/shared/dist 2>/dev/null || true

info "Removing TypeScript build info files..."
find . -name "*.tsbuildinfo" \
  -not -path "*/node_modules/*" \
  -delete 2>/dev/null || true

info "Removing Vite cache..."
rm -rf apps/web/node_modules/.vite 2>/dev/null || true

# ---------------------------------------------------------------------------
# Optional: clear node_modules (uncomment to do a full reset)
# ---------------------------------------------------------------------------
# warn "Removing node_modules (full reset)..."
# rm -rf node_modules apps/web/node_modules apps/api/node_modules packages/shared/node_modules

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================="
echo "  Cache clean complete!"
echo "============================================="
echo ""
echo "  To reinstall everything, run:  ./setup.sh"
echo ""
