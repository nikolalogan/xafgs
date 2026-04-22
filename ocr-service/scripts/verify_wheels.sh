#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_DIR="$ROOT_DIR/ocr-service"
WHEELS_DIR="$SERVICE_DIR/wheels"

if command -v cygpath >/dev/null 2>&1; then
  SERVICE_DIR_DOCKER="$(cygpath -aw "$SERVICE_DIR" | tr '\\' '/')"
else
  SERVICE_DIR_DOCKER="$SERVICE_DIR"
fi

if [[ ! -d "$WHEELS_DIR" ]]; then
  echo "missing wheels directory: $WHEELS_DIR" >&2
  exit 1
fi

PYTHON_BASE_IMAGE="${PYTHON_BASE_IMAGE:-docker.1panel.live/library/python:3.11-slim}"

echo "Verifying offline wheels with image: $PYTHON_BASE_IMAGE"

docker run --rm \
  -v "$SERVICE_DIR_DOCKER:/workspace" \
  "$PYTHON_BASE_IMAGE" \
  sh -lc "python -m venv /tmp/venv \
    && /tmp/venv/bin/pip install --upgrade pip >/dev/null \
    && /tmp/venv/bin/pip install --no-index --find-links /workspace/wheels -r /workspace/requirements.txt"
