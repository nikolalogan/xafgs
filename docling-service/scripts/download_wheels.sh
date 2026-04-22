#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_DIR="$ROOT_DIR/docling-service"
WHEELS_DIR="$SERVICE_DIR/wheels"

if command -v cygpath >/dev/null 2>&1; then
  SERVICE_DIR_DOCKER="$(cygpath -aw "$SERVICE_DIR" | tr '\\' '/')"
else
  SERVICE_DIR_DOCKER="$SERVICE_DIR"
fi

mkdir -p "$WHEELS_DIR"

PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple}"
PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-mirrors.aliyun.com}"
PIP_DEFAULT_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-600}"
PIP_RETRIES="${PIP_RETRIES:-10}"
PYTHON_BASE_IMAGE="${PYTHON_BASE_IMAGE:-swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/python:3.11-slim}"

echo "Using Python base image: $PYTHON_BASE_IMAGE"

docker run --rm \
  -e PIP_INDEX_URL="$PIP_INDEX_URL" \
  -e PIP_TRUSTED_HOST="$PIP_TRUSTED_HOST" \
  -e PIP_DEFAULT_TIMEOUT="$PIP_DEFAULT_TIMEOUT" \
  -e PIP_RETRIES="$PIP_RETRIES" \
  -v "$SERVICE_DIR_DOCKER:/workspace" \
  "$PYTHON_BASE_IMAGE" \
  sh -lc "python -m pip install --upgrade pip >/dev/null \
    && pip download --dest /workspace/wheels \
      --index-url \"$PIP_INDEX_URL\" \
      --trusted-host \"$PIP_TRUSTED_HOST\" \
      --retries \"$PIP_RETRIES\" \
      --progress-bar off \
      -r /workspace/requirements.txt"
