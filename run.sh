#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
#  Covaris BOM Viewer — local dev launcher (Mac/Linux)
#
#  Installs dependencies if needed, then starts the Vite dev
#  server on http://localhost:5173.
#
#  Usage:
#    ./run.sh
# ────────────────────────────────────────────────────────────────

set -euo pipefail

cd "$(dirname "$0")"

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[ERROR] Node.js is not installed or not on PATH."
  echo "Please install Node.js 18 or later from https://nodejs.org/"
  echo
  exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo
echo "Starting Vite dev server on http://localhost:5173 ..."
echo "Press Ctrl+C to stop."
echo

npm run dev
