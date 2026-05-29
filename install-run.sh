#!/usr/bin/env bash
# dev.sh — Install dependencies, build, and start AEM Email Doctor.
# Works on macOS, Linux, and Windows (Git Bash / WSL).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MIN_NODE=18
PORT="${PORT:-5000}"

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m%s\033[0m\n' "$*"; }
err()   { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

check_node() {
  if ! command -v node &>/dev/null; then
    err "Node.js is not installed."
    err "Install Node.js $MIN_NODE+ from https://nodejs.org"
    exit 1
  fi

  local ver
  ver=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$ver" -lt "$MIN_NODE" ]; then
    err "Node.js v$ver found, but v$MIN_NODE+ is required."
    exit 1
  fi
  ok "Node.js $(node -v) OK"
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    err "npm is not installed. It should come with Node.js."
    exit 1
  fi
  ok "npm $(npm -v) OK"
}

# ── Main ─────────────────────────────────────────────────────────────────────

info "AEM Email Doctor — dev setup"
echo ""

check_node
check_npm

echo ""
info "Installing dependencies..."
npm install

echo ""
info "Building..."
npm run build

echo ""
ok "Build complete."
info "Starting web UI on port $PORT..."
echo ""

node dist/cli/index.js serve --port "$PORT"
