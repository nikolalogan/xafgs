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
BACKUP_KEEP="${BACKUP_KEEP:-5}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-${REMOTE_APP_DIR}.backups}"

run_remote() {
  if [[ -n "${REMOTE_PORT}" ]]; then
    ssh -p "${REMOTE_PORT}" "${SSH_TARGET}" "$1"
  else
    ssh "${SSH_TARGET}" "$1"
  fi
}

package_project() {
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
  echo "==> 打包完成：${LOCAL_ARCHIVE}"
}

push_archive() {
  if [[ ! -f "${LOCAL_ARCHIVE}" ]]; then
    echo "未找到本地归档：${LOCAL_ARCHIVE}" >&2
    echo "请先执行打包（选项 1）或直接部署（选项 3/4）。" >&2
    exit 1
  fi

  echo "==> 上传到 ${SSH_TARGET}:${REMOTE_ARCHIVE}"
  if [[ -n "${REMOTE_PORT}" ]]; then
    scp -P "${REMOTE_PORT}" "${LOCAL_ARCHIVE}" "${SSH_TARGET}:${REMOTE_ARCHIVE}"
  else
    scp "${LOCAL_ARCHIVE}" "${SSH_TARGET}:${REMOTE_ARCHIVE}"
  fi
}

backup_remote() {
  echo "==> 备份远端应用目录：${REMOTE_APP_DIR}"
  run_remote \
    "set -euo pipefail
     backup_dir='${REMOTE_BACKUP_DIR}'
     mkdir -p '${REMOTE_APP_DIR}' \"\${backup_dir}\"
     backup_file=\"\${backup_dir}/app-\"\$(date +%Y%m%d-%H%M%S)\".tar.gz\"
     tar -czf \"\${backup_file}\" -C '${REMOTE_APP_DIR}' .
     ls -1t \"\${backup_dir}\"/app-*.tar.gz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f
     echo \"备份完成：\${backup_file}\""
}

deploy_remote() {
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
     if docker compose config --services | grep -qx 'postgres'; then
       echo '检测到编排中包含 postgres 服务，生产部署禁止启动内置 PostgreSQL。请检查 docker-compose.yml。' >&2
       exit 1
     fi
     if docker ps >/dev/null 2>&1; then
       docker compose up -d --build --remove-orphans
       docker compose ps
     elif sudo -n docker ps >/dev/null 2>&1; then
       if sudo docker compose config --services | grep -qx 'postgres'; then
         echo '检测到编排中包含 postgres 服务，生产部署禁止启动内置 PostgreSQL。请检查 docker-compose.yml。' >&2
         exit 1
       fi
       sudo docker compose up -d --build --remove-orphans
       sudo docker compose ps
     else
       echo '当前远端用户没有 Docker 权限。请在服务器执行：sudo usermod -aG docker logan，然后重新登录；或配置 sudo 免密后重试。' >&2
       exit 1
     fi"

  echo "==> 部署完成：http://${REMOTE_HOST}:325"
}

run_action() {
  case "$1" in
    1)
      package_project
      ;;
    2)
      push_archive
      ;;
    3)
      package_project
      push_archive
      deploy_remote
      ;;
    4)
      package_project
      push_archive
      backup_remote
      deploy_remote
      ;;
    *)
      echo "无效选项：$1" >&2
      echo "可用选项：1(打包) 2(推送) 3(直接部署) 4(先备份再部署)" >&2
      exit 1
      ;;
  esac
}

print_menu() {
  cat <<'EOF'
请选择操作：
  1) 打包
  2) 推送
  3) 直接部署
  4) 先备份再部署
EOF
}

main() {
  if [[ $# -ge 1 ]]; then
    run_action "$1"
    return
  fi

  print_menu
  printf "请输入选项 [1-4]: "
  read -r choice
  run_action "${choice}"
}

main "$@"
