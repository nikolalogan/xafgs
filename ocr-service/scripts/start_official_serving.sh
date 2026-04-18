#!/usr/bin/env bash
set -euo pipefail

SERVE_HOST="${OCR_API_HOST:-0.0.0.0}"
SERVE_PORT="${PORT:-8090}"

echo "Starting OCR FastAPI service..."
echo "  host=${SERVE_HOST}"
echo "  port=${SERVE_PORT}"
echo "  device=${OCR_PPSTRUCTURE_DEVICE:-cpu}"
echo "  paddle_package=${OCR_PADDLE_PACKAGE:-paddlepaddle-gpu}"
python -c "import importlib; \
paddle=importlib.import_module('paddle'); \
paddlex=importlib.import_module('paddlex'); \
print('  paddle_version=' + getattr(paddle, '__version__', 'unknown')); \
print('  paddlex_version=' + getattr(paddlex, '__version__', 'unknown'))"

exec uvicorn app.main:app --host "${SERVE_HOST}" --port "${SERVE_PORT}"
