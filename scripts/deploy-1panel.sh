#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SSH_TARGET="${SSH_TARGET:-sxfgs-1panel}"
REMOTE_HOST="${REMOTE_HOST:-192.168.109.4}"
REMOTE_PORT="${REMOTE_PORT:-}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/logan/sxfgs/app}"
REMOTE_FILE_DIR="${REMOTE_FILE_DIR:-/home/logan/sxfgs/file}"
ARCHIVE_NAME="sxfgssever-1panel.tar.gz"
LOCAL_ARCHIVE="${PROJECT_ROOT}/${ARCHIVE_NAME}"
REMOTE_ARCHIVE="/tmp/${ARCHIVE_NAME}"

run_remote() {
  if [[ -n "${REMOTE_PORT}" ]]; then
    ssh -p "${REMOTE_PORT}" "${SSH_TARGET}" "$1"
  else
    ssh "${SSH_TARGET}" "$1"
  fi
}

echo "==> 打包项目（不包含 demo 服务）"
cd "${PROJECT_ROOT}"
rm -f "${LOCAL_ARCHIVE}"
tar \
  --exclude="web/node_modules" \
  --exclude="web/.next" \
  --exclude="web/tsconfig.tsbuildinfo" \
  --exclude="server/tmp" \
  --exclude=".DS_Store" \
  -czf "${LOCAL_ARCHIVE}" \
  "docker-compose.yml" \
  "web" \
  "server" \
  "deploy"

echo "==> 上传到 ${SSH_TARGET}:${REMOTE_ARCHIVE}"
if [[ -n "${REMOTE_PORT}" ]]; then
  scp -P "${REMOTE_PORT}" "${LOCAL_ARCHIVE}" "${SSH_TARGET}:${REMOTE_ARCHIVE}"
else
  scp "${LOCAL_ARCHIVE}" "${SSH_TARGET}:${REMOTE_ARCHIVE}"
fi

echo "==> 远端解压到 ${REMOTE_APP_DIR}"
run_remote \
  "set -euo pipefail
   mkdir -p '${REMOTE_APP_DIR}' '${REMOTE_FILE_DIR}'
   find '${REMOTE_APP_DIR}' -mindepth 1 -maxdepth 1 -exec rm -rf {} +
   tar -xzf '${REMOTE_ARCHIVE}' -C '${REMOTE_APP_DIR}'
   rm -f '${REMOTE_ARCHIVE}'"

echo "==> 重建并启动 Docker Compose"
run_remote \
  "set -euo pipefail
   cd '${REMOTE_APP_DIR}'
   if docker ps >/dev/null 2>&1; then
     docker compose up -d --build --remove-orphans
     docker compose ps
   elif sudo -n docker ps >/dev/null 2>&1; then
     sudo docker compose up -d --build --remove-orphans
     sudo docker compose ps
   else
     echo '当前远端用户没有 Docker 权限。请在服务器执行：sudo usermod -aG docker logan，然后重新登录；或配置 sudo 免密后重试。' >&2
     exit 1
   fi"

echo "==> 部署完成：http://${REMOTE_HOST}:325"
