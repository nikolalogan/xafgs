#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHEELS_DIR="${ROOT_DIR}/wheels"
REQ_FILE="${ROOT_DIR}/requirements.txt"
CONSTRAINTS_FILE="${ROOT_DIR}/constraints.txt"

PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple}"
PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-mirrors.aliyun.com}"
PADDLE_WHEEL_INDEX_URL="${PADDLE_WHEEL_INDEX_URL:-https://www.paddlepaddle.org.cn/packages/stable/cpu/}"
PLATFORMS="${WHEEL_PLATFORMS:-manylinux_2_17_x86_64}"
PADDLE_WHEEL_PLATFORMS="${PADDLE_WHEEL_PLATFORMS:-manylinux1_x86_64 manylinux_2_17_x86_64 manylinux_2_28_x86_64}"
PYTHON_VERSION="${WHEEL_PYTHON_VERSION:-311}"
IMPLEMENTATION="${WHEEL_IMPLEMENTATION:-cp}"
PIP_RETRIES="${PIP_RETRIES:-10}"
PIP_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-600}"

mkdir -p "${WHEELS_DIR}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
BEFORE_LIST="${TMP_DIR}/wheels-before.txt"
AFTER_LIST="${TMP_DIR}/wheels-after.txt"

find "${WHEELS_DIR}" -maxdepth 1 -type f -name '*.whl' -print | sort > "${BEFORE_LIST}"

for platform in ${PLATFORMS}; do
  echo "Syncing wheels for platform: ${platform}"
  if python3 -m pip download \
    --dest "${WHEELS_DIR}" \
    --only-binary=:all: \
    --prefer-binary \
    --platform "${platform}" \
    --python-version "${PYTHON_VERSION}" \
    --implementation "${IMPLEMENTATION}" \
    --index-url "${PIP_INDEX_URL}" \
    --trusted-host "${PIP_TRUSTED_HOST}" \
    --retries "${PIP_RETRIES}" \
    --timeout "${PIP_TIMEOUT}" \
    -r "${REQ_FILE}"; then
    echo "Sync wheels success for platform: ${platform}"
  else
    echo "Sync wheels failed for platform: ${platform}, continue next platform"
  fi
done

# 某些主机（如 macOS）上 requirements 的平台 marker 会导致 paddlepaddle 被过滤，
# 这里按目标平台显式补拉一次，确保离线构建关键包完整。
for platform in ${PADDLE_WHEEL_PLATFORMS}; do
  echo "Ensuring paddlepaddle wheel for platform: ${platform}"
  if find "${WHEELS_DIR}" -maxdepth 1 -type f -name 'paddlepaddle-3.2.0*.whl' | grep -q .; then
    echo "paddlepaddle wheel already exists, skip ensure step."
    break
  fi
  if python3 -m pip download \
    --dest "${WHEELS_DIR}" \
    --only-binary=:all: \
    --prefer-binary \
    --platform "${platform}" \
    --python-version "${PYTHON_VERSION}" \
    --implementation "${IMPLEMENTATION}" \
    --index-url "${PIP_INDEX_URL}" \
    --extra-index-url "${PADDLE_WHEEL_INDEX_URL}" \
    --trusted-host "${PIP_TRUSTED_HOST}" \
    --trusted-host "www.paddlepaddle.org.cn" \
    --retries "${PIP_RETRIES}" \
    --timeout "${PIP_TIMEOUT}" \
    --no-deps \
    "paddlepaddle==3.2.0"; then
    echo "Ensure paddlepaddle success for platform: ${platform}"
    break
  else
    echo "Ensure paddlepaddle failed for platform: ${platform}, continue next platform"
  fi
done

# 离线安装时，paddlepaddle 仍会要求部分传递依赖（如 protobuf）。
# 在 macOS 主机下载 linux wheel 场景下，这些依赖可能不会被自动补齐，需显式拉取。
RUNTIME_ESSENTIALS=(
  "protobuf>=3.20.2"
  "opt_einsum==3.3.0"
  "networkx"
  "safetensors>=0.6.0"
)
for platform in ${PLATFORMS}; do
  for requirement in "${RUNTIME_ESSENTIALS[@]}"; do
    echo "Ensuring runtime dependency '${requirement}' for platform: ${platform}"
    if python3 -m pip download \
      --dest "${WHEELS_DIR}" \
      --only-binary=:all: \
      --prefer-binary \
      --platform "${platform}" \
      --python-version "${PYTHON_VERSION}" \
      --implementation "${IMPLEMENTATION}" \
      --index-url "${PIP_INDEX_URL}" \
      --trusted-host "${PIP_TRUSTED_HOST}" \
      --retries "${PIP_RETRIES}" \
      --timeout "${PIP_TIMEOUT}" \
      --no-deps \
      "${requirement}"; then
      echo "Ensure runtime dependency success: ${requirement}"
    else
      echo "Ensure runtime dependency failed: ${requirement} on ${platform}, continue"
    fi
  done
done

critical=(
  "paddlepaddle-3.2.0"
  "paddleocr-3.4.0"
  "paddlex-3.4"
  "opencv_contrib_python-4.10.0.84"
  "protobuf-4.25.8"
  "opt_einsum-3.3.0"
  "aiohttp-3.12"
  "filetype-1.2.0"
)
for pattern in "${critical[@]}"; do
  if ! find "${WHEELS_DIR}" -maxdepth 1 -type f -name "${pattern}*.whl" | grep -q .; then
    echo "Missing critical wheel: ${pattern}*.whl"
    echo "Current wheel count: $(find "${WHEELS_DIR}" -maxdepth 1 -type f -name '*.whl' | wc -l | tr -d ' ')"
    exit 1
  fi
done

find "${WHEELS_DIR}" -maxdepth 1 -type f -name '*.whl' -print | sort > "${AFTER_LIST}"
BEFORE_COUNT="$(wc -l < "${BEFORE_LIST}" | tr -d ' ')"
AFTER_COUNT="$(wc -l < "${AFTER_LIST}" | tr -d ' ')"
ADDED_COUNT=$((AFTER_COUNT - BEFORE_COUNT))
if [ "${ADDED_COUNT}" -lt 0 ]; then
  ADDED_COUNT=0
fi

echo "Wheel sync complete: ${WHEELS_DIR}"
echo "Wheel count before: ${BEFORE_COUNT}"
echo "Wheel count after : ${AFTER_COUNT}"
echo "New wheels added  : ${ADDED_COUNT}"
if [ "${ADDED_COUNT}" -gt 0 ]; then
  echo "Added wheel files:"
  comm -13 "${BEFORE_LIST}" "${AFTER_LIST}" | sed 's#^.*/##'
else
  echo "No new wheels were added."
fi
