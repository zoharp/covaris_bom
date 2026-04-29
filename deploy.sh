#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
#  Covaris BOM Viewer — Vercel production deploy (Mac/Linux)
#
#  Prerequisites (one-time):
#    1. Install Vercel CLI:   npm install -g vercel
#    2. Log in to Vercel:     vercel login
#    3. Link project:         vercel link  (first time only)
#
#  Usage:
#    ./deploy.sh
# ────────────────────────────────────────────────────────────────

set -euo pipefail

cd "$(dirname "$0")"

# Sanity checks
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed or not on PATH."
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo
  echo "[ERROR] Vercel CLI is not installed."
  echo "Run: npm install -g vercel"
  echo "Then: vercel login"
  exit 1
fi

# Install dependencies if missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build
echo
echo "Building production bundle..."
npm run build

# Deploy
echo
echo "Deploying to Vercel (production)..."
echo
vercel --prod
