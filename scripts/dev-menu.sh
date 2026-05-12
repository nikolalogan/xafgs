#!/usr/bin/env bash

set -euo pipefail

DEV_COMPOSE_FILE="${1:-${DEV_COMPOSE_FILE:-docker-compose.dev.yml}}"

START_ITEMS=(
  "frontend:menu-start-frontend"
  "backend:menu-start-backend"
  "ocr-service:menu-start-ocr-service"
  "ocr-table-service:menu-start-ocr-table-service"
  "docling-service:menu-start-docling-service"
  "vllm:menu-start-vllm"
  "gateway:menu-start-gateway"
  "postgres:menu-start-postgres"
  "redis:menu-start-redis"
)

BUILD_ITEMS=(
  "frontend:menu-build-frontend"
  "backend:menu-build-backend"
  "ocr-service:menu-build-ocr-service"
  "ocr-table-service:menu-build-ocr-table-service"
  "docling-service:menu-build-docling-service"
  "vllm:menu-build-vllm"
  "gateway:menu-build-gateway"
  "postgres:menu-build-postgres"
  "redis:menu-build-redis"
)

PRELOAD_ITEMS=(
  "ocr-table-layout:menu-preload-ocr-table-layout"
  "ocr-table-structure:menu-preload-ocr-table-structure"
  "ocr-table-all:menu-preload-ocr-table-all"
  "docling-model:menu-preload-docling"
)

run_make() {
  make DEV_COMPOSE_FILE="$DEV_COMPOSE_FILE" "$@"
}

show_header() {
  echo
  echo "项目开发菜单"
  echo "当前开发编排文件: $DEV_COMPOSE_FILE"
  echo
}

pause_menu() {
  echo
  read -r -p "按回车键返回菜单..." _
}

show_main_menu() {
  echo "请选择操作:"
  echo "  1) 启动"
  echo "  2) 打包"
  echo "  3) 预加载"
  echo "  4) 停止"
  echo "  5) 日志"
  echo "  6) 状态"
  echo "  0) 退出"
  echo
}

show_submenu_with_items() {
  local title="$1"
  shift
  local -n items_ref=$1
  echo "请选择${title}操作:"
  echo "  1) 全部"
  echo "  2) 单个"
  echo "  0) 返回上级"
  echo
  if [[ "${#items_ref[@]}" -gt 0 ]]; then
    echo "${title}可选项:"
    local idx=1
    local entry
    for entry in "${items_ref[@]}"; do
      echo "  ${idx}) ${entry%%:*}"
      idx=$((idx + 1))
    done
    echo
  fi
}

choose_single_and_run() {
  local title="$1"
  shift
  local -n items_ref=$1
  local choice entry target idx
  echo "请选择单个${title}项:"
  idx=1
  for entry in "${items_ref[@]}"; do
    echo "  ${idx}) ${entry%%:*}"
    idx=$((idx + 1))
  done
  echo "  0) 返回上级"
  echo
  read -r -p "输入选项编号: " choice
  choice="${choice%$'\r'}"
  if [[ "$choice" == "0" ]]; then
    return
  fi
  if [[ ! "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#items_ref[@]} )); then
    echo "无效选项: $choice"
    pause_menu
    return
  fi
  entry="${items_ref[$((choice - 1))]}"
  target="${entry#*:}"
  run_make "$target"
  pause_menu
}

show_start_menu() {
  while true; do
    show_header
    show_submenu_with_items "启动" START_ITEMS
    read -r -p "输入选项编号: " choice
    choice="${choice%$'\r'}"
    case "$choice" in
      1)
        run_make menu-start-all
        pause_menu
        ;;
      2)
        choose_single_and_run "启动" START_ITEMS
        ;;
      0)
        return
        ;;
      *)
        echo "无效选项: $choice"
        pause_menu
        ;;
    esac
  done
}

show_build_menu() {
  while true; do
    show_header
    show_submenu_with_items "打包" BUILD_ITEMS
    read -r -p "输入选项编号: " choice
    choice="${choice%$'\r'}"
    case "$choice" in
      1)
        run_make menu-build-all
        pause_menu
        ;;
      2)
        choose_single_and_run "打包" BUILD_ITEMS
        ;;
      0)
        return
        ;;
      *)
        echo "无效选项: $choice"
        pause_menu
        ;;
    esac
  done
}

show_preload_menu() {
  while true; do
    show_header
    show_submenu_with_items "预加载" PRELOAD_ITEMS
    read -r -p "输入选项编号: " choice
    choice="${choice%$'\r'}"
    case "$choice" in
      1)
        run_make menu-preload-all
        pause_menu
        ;;
      2)
        choose_single_and_run "预加载" PRELOAD_ITEMS
        ;;
      0)
        return
        ;;
      *)
        echo "无效选项: $choice"
        pause_menu
        ;;
    esac
  done
}

while true; do
  show_header
  show_main_menu
  read -r -p "输入选项编号: " choice
  choice="${choice%$'\r'}"
  case "$choice" in
    1)
      show_start_menu
      ;;
    2)
      show_build_menu
      ;;
    3)
      show_preload_menu
      ;;
    4)
      run_make down
      pause_menu
      ;;
    5)
      run_make logs
      ;;
    6)
      run_make ps
      pause_menu
      ;;
    0)
      exit 0
      ;;
    *)
      echo "无效选项: $choice"
      pause_menu
      ;;
  esac
done
