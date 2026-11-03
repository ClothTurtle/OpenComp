#!/usr/bin/env sh
# One-click launcher for macOS/Linux: installs dependencies on first run, then opens OpenComp in your browser.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "OpenComp needs Node.js 20 or newer: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

exec npm run dev -- --open
