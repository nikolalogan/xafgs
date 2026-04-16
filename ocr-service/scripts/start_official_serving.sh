#!/usr/bin/env bash
set -euo pipefail

SERVE_HOST="${OCR_API_HOST:-0.0.0.0}"
SERVE_PORT="${PORT:-8090}"

echo "Starting OCR FastAPI service..."
echo "  host=${SERVE_HOST}"
echo "  port=${SERVE_PORT}"

exec uvicorn app.main:app --host "${SERVE_HOST}" --port "${SERVE_PORT}"
