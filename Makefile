.PHONY: help menu dev dev-build dev-fresh dev-rebuild-backend dev-rebuild-backend-fresh macdev macdev-build macdev-fresh macdev-rebuild-backend macdev-rebuild-backend-fresh windev windev-build windev-fresh windev-rebuild-backend windev-rebuild-backend-fresh prod down dev-down prod-down logs ps ocr-wheels-sync ocr-wheels-verify ocr-build ocr-build-offline ocr-build-online-fallback ocr-table-wheels-sync ocr-table-wheels-verify ocr-table-build ocr-table-build-offline ocr-table-build-online-fallback ocr-table-model-cache-init ocr-table-rebuild-image ocr-table-cache-warm ocr-table-model-cache-warm ocr-table-layout-model-cache-warm ocr-table-detection-model-cache-warm ocr-table-cache-verify-offline docling-wheels-sync docling-model-cache-init docling-model-cache-warm docling-build docling-build-offline docling-build-online-fallback menu-start-all menu-start-frontend menu-start-backend menu-start-ocr-service menu-start-ocr-table-service menu-start-docling-service menu-start-vllm menu-start-gateway menu-start-postgres menu-start-redis menu-build-all menu-build-frontend menu-build-backend menu-build-ocr-service menu-build-ocr-table-service menu-build-docling-service menu-build-vllm menu-build-gateway menu-build-postgres menu-build-redis menu-preload-all menu-preload-ocr-table-layout menu-preload-ocr-table-structure menu-preload-ocr-table-all menu-preload-docling

ifeq ($(OS),Windows_NT)
UNAME_S := Windows_NT
DEV_COMPOSE_FILE := docker-compose.dev.win.yml
MSYS_NO_PATHCONV_RUN := MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL=*
else
UNAME_S := $(shell uname -s 2>/dev/null || echo Unknown)
ifeq ($(UNAME_S),Darwin)
DEV_COMPOSE_FILE := docker-compose.dev.mac.yml
else
DEV_COMPOSE_FILE := docker-compose.dev.yml
endif
MSYS_NO_PATHCONV_RUN :=
endif

help:
	@echo "可用命令:"
	@echo "  make menu     # 菜单式启动/构建/缓存管理入口（支持全部/单服务先停后启，推荐）"
	@echo "  make macdev    # macOS 开发模式快速启动（不默认构建）"
	@echo "  make macdev-build # macOS 开发模式启动并构建镜像"
	@echo "  make macdev-fresh # macOS 无缓存重建 backend 后启动"
	@echo "  make windev    # Windows 开发模式快速启动（不默认构建）"
	@echo "  make windev-build # Windows 开发模式启动并构建镜像"
	@echo "  make windev-fresh # Windows 无缓存重建 backend 后启动"
	@echo "  当前开发编排文件: $(DEV_COMPOSE_FILE)"
	@echo "  make dev       # 兼容旧命令，等同 macdev"
	@echo "  make dev-build # 兼容旧命令，等同 macdev-build"
	@echo "  make dev-fresh # 兼容旧命令，等同 macdev-fresh"
	@echo "  make dev-rebuild-backend # 缓存重建开发后端镜像"
	@echo "  make dev-rebuild-backend-fresh # 无缓存重建开发后端镜像"
	@echo "  make ocr-wheels-sync # 同步主 OCR 依赖到本地 wheels 缓存目录"
	@echo "  make ocr-wheels-verify # 校验主 OCR wheels 是否可离线覆盖依赖闭包"
	@echo "  make ocr-build # 自动同步+校验 wheels，再离线构建主 OCR 镜像（推荐）"
	@echo "  make ocr-build-offline # 仅使用本地 wheels 构建主 OCR 镜像（缺包即失败）"
	@echo "  make ocr-build-online-fallback # 自动同步 wheels 后构建主 OCR 镜像（允许缺包回源）"
	@echo "  make ocr-table-wheels-sync # 同步表格提取依赖到本地 wheels 缓存目录"
	@echo "  make ocr-table-wheels-verify # 校验表格提取 wheels 是否可离线覆盖依赖闭包"
	@echo "  make ocr-table-cache-warm # 预热表格提取模型缓存（detection + structure + timm）"
	@echo "  make ocr-table-cache-verify-offline # 离线校验表格提取模型缓存完整性（仅本地文件检查）"
	@echo "  make ocr-table-layout-model-cache-warm # 兼容命令：联网预热 TATR detection 模型缓存"
	@echo "  make ocr-table-detection-model-cache-warm # 联网预热 TATR detection 模型缓存"
	@echo "  make ocr-table-model-cache-warm # 联网预热 TATR structure + timm 模型缓存"
	@echo "  make ocr-table-build # 自动同步+校验 wheels 后离线构建表格提取镜像（推荐）"
	@echo "  make ocr-table-build-offline # 仅使用本地 wheels 构建表格提取镜像"
	@echo "  make ocr-table-build-online-fallback # 自动同步 wheels 后构建表格提取镜像（允许缺包回源）"
	@echo "  make docling-wheels-sync # 同步 Docling Python 依赖到本地 wheels 缓存目录"
	@echo "  make docling-model-cache-init # 初始化本地 Docling 模型缓存目录"
	@echo "  make docling-model-cache-warm # 预热本地 Docling 模型缓存到 model_cache"
	@echo "  make docling-build # 自动同步+预热后离线构建 Docling 镜像（推荐）"
	@echo "  make docling-build-offline # 仅使用本地 wheels 构建 Docling 镜像"
	@echo "  make docling-build-online-fallback # 自动同步 wheels 后构建 Docling 镜像（允许缺包回源）"
	@echo "  make prod      # 生产模式启动"
	@echo "  make down      # 停止开发+生产所有容器"
	@echo "  make dev-down  # 仅停止开发模式容器"
	@echo "  make prod-down # 仅停止生产模式容器"
	@echo "  make logs      # 查看开发模式日志"
	@echo "  make ps        # 查看容器状态"
	@echo "  make menu-start-all / menu-start-<service> # 菜单统一入口：全部/单服务启动"
	@echo "  make menu-build-all / menu-build-<service> # 菜单统一入口：全部/单服务打包"
	@echo "  make menu-preload-all / menu-preload-<item> # 菜单统一入口：模型相关预加载"

ifeq ($(OS),Windows_NT)
menu: SHELL := powershell.exe
menu: .SHELLFLAGS := -ExecutionPolicy Bypass -Command
menu:
	& { .\scripts\dev-menu.ps1 "$(DEV_COMPOSE_FILE)" }
else
menu:
	bash scripts/dev-menu.sh "$(DEV_COMPOSE_FILE)"
endif

dev: macdev

dev-build: macdev-build

dev-fresh: macdev-fresh

dev-rebuild-backend: macdev-rebuild-backend

dev-rebuild-backend-fresh: macdev-rebuild-backend-fresh

macdev:
	docker compose -f docker-compose.dev.mac.yml up

macdev-build:
	docker compose -f docker-compose.dev.mac.yml up --build

macdev-fresh: macdev-rebuild-backend-fresh
	docker compose -f docker-compose.dev.mac.yml up --build

macdev-rebuild-backend:
	docker compose -f docker-compose.dev.mac.yml build backend

macdev-rebuild-backend-fresh:
	docker compose -f docker-compose.dev.mac.yml build --no-cache backend

windev:
	docker compose -f docker-compose.dev.win.yml up

windev-build:
	docker compose -f docker-compose.dev.win.yml up --build

windev-fresh: windev-rebuild-backend-fresh
	docker compose -f docker-compose.dev.win.yml up --build

windev-rebuild-backend:
	docker compose -f docker-compose.dev.win.yml build backend

windev-rebuild-backend-fresh:
	docker compose -f docker-compose.dev.win.yml build --no-cache backend

ocr-wheels-sync:
	bash ocr-service/scripts/download_wheels.sh

ocr-wheels-verify:
	bash ocr-service/scripts/verify_wheels.sh

ocr-build: ocr-wheels-sync ocr-wheels-verify
	OCR_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build ocr-service

ocr-build-offline: ocr-wheels-verify
	OCR_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build ocr-service

ocr-build-online-fallback: ocr-wheels-sync
	OCR_WHEELS_ONLY=0 docker compose -f $(DEV_COMPOSE_FILE) build ocr-service

ocr-table-wheels-sync:
	bash ocr-table-service/scripts/download_wheels.sh

ocr-table-wheels-verify:
	bash ocr-table-service/scripts/verify_wheels.sh

ocr-table-model-cache-init:
	mkdir -p ocr-table-service/model_cache

ocr-table-rebuild-image:
	OCR_TABLE_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build ocr-table-service

ocr-table-cache-warm: ocr-table-layout-model-cache-warm ocr-table-model-cache-warm

ocr-table-detection-model-cache-warm: ocr-table-layout-model-cache-warm

ocr-table-layout-model-cache-warm: ocr-table-model-cache-init ocr-table-rebuild-image
	$(MSYS_NO_PATHCONV_RUN) docker compose -f $(DEV_COMPOSE_FILE) run --rm -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 -e HF_DATASETS_OFFLINE=0 -e HF_ENDPOINT=$${HF_ENDPOINT:-https://huggingface.co} -e HF_HUB_CACHE=/app/model_cache/hf/hub ocr-table-service python /app/scripts/preload_table_layout_model.py

ocr-table-model-cache-warm: ocr-table-model-cache-init ocr-table-rebuild-image
	$(MSYS_NO_PATHCONV_RUN) docker compose -f $(DEV_COMPOSE_FILE) run --rm -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 -e HF_DATASETS_OFFLINE=0 -e HF_ENDPOINT=$${HF_ENDPOINT:-https://huggingface.co} -e HF_HUB_CACHE=/app/model_cache/hf/hub ocr-table-service python /app/scripts/preload_table_structure_model.py

ocr-table-cache-verify-offline:
	$(MSYS_NO_PATHCONV_RUN) docker compose -f $(DEV_COMPOSE_FILE) run --rm -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e HF_DATASETS_OFFLINE=1 -e HF_HUB_CACHE=/app/model_cache/hf/hub ocr-table-service python /app/scripts/verify_table_cache_offline.py

ocr-table-build: ocr-table-model-cache-init ocr-table-wheels-sync ocr-table-wheels-verify
	OCR_TABLE_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build ocr-table-service

ocr-table-build-offline: ocr-table-model-cache-init ocr-table-wheels-verify
	OCR_TABLE_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build ocr-table-service

ocr-table-build-online-fallback: ocr-table-model-cache-init ocr-table-wheels-sync
	OCR_TABLE_WHEELS_ONLY=0 docker compose -f $(DEV_COMPOSE_FILE) build ocr-table-service

docling-wheels-sync:
	bash docling-service/scripts/download_wheels.sh

docling-model-cache-init:
	mkdir -p docling-service/model_cache

docling-model-cache-warm: docling-model-cache-init docling-wheels-sync
	DOCLING_WHEELS_ONLY=0 docker compose -f $(DEV_COMPOSE_FILE) build docling-service
	$(MSYS_NO_PATHCONV_RUN) docker compose -f $(DEV_COMPOSE_FILE) run --rm -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 -e HF_ENDPOINT=$${HF_ENDPOINT:-https://huggingface.co} docling-service python scripts/preload_models.py

docling-build: docling-model-cache-init docling-wheels-sync docling-model-cache-warm
	DOCLING_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build docling-service

docling-build-offline: docling-model-cache-init
	DOCLING_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build docling-service

docling-build-online-fallback: docling-model-cache-init docling-wheels-sync
	DOCLING_WHEELS_ONLY=0 docker compose -f $(DEV_COMPOSE_FILE) build docling-service

prod:
	docker compose up --build -d

down: dev-down prod-down

dev-down:
	docker compose -f $(DEV_COMPOSE_FILE) down

prod-down:
	docker compose down

logs:
	docker compose -f $(DEV_COMPOSE_FILE) logs -f

ps:
	docker compose -f $(DEV_COMPOSE_FILE) ps
	docker compose ps

menu-start-all:
	docker compose -f $(DEV_COMPOSE_FILE) down
	docker compose -f $(DEV_COMPOSE_FILE) up -d

menu-start-frontend:
	docker compose -f $(DEV_COMPOSE_FILE) stop frontend
	docker compose -f $(DEV_COMPOSE_FILE) rm -f frontend
	docker compose -f $(DEV_COMPOSE_FILE) up -d frontend

menu-start-backend:
	docker compose -f $(DEV_COMPOSE_FILE) stop backend
	docker compose -f $(DEV_COMPOSE_FILE) rm -f backend
	docker compose -f $(DEV_COMPOSE_FILE) up -d backend

menu-start-ocr-service:
	docker compose -f $(DEV_COMPOSE_FILE) stop ocr-service
	docker compose -f $(DEV_COMPOSE_FILE) rm -f ocr-service
	docker compose -f $(DEV_COMPOSE_FILE) up -d ocr-service

menu-start-ocr-table-service:
	@echo "提示: 当前为离线运行模式启动。"
	@if ! $(MAKE) --no-print-directory ocr-table-cache-verify-offline; then \
		echo "提示: 离线缓存校验未通过，请先执行 make menu-preload-ocr-table-layout / make menu-preload-ocr-table-structure / make menu-preload-ocr-table-all"; \
	fi
	docker compose -f $(DEV_COMPOSE_FILE) stop ocr-table-service
	docker compose -f $(DEV_COMPOSE_FILE) rm -f ocr-table-service
	docker compose -f $(DEV_COMPOSE_FILE) up -d ocr-table-service

menu-start-docling-service:
	docker compose -f $(DEV_COMPOSE_FILE) stop docling-service
	docker compose -f $(DEV_COMPOSE_FILE) rm -f docling-service
	docker compose -f $(DEV_COMPOSE_FILE) up -d docling-service

menu-start-vllm:
	docker compose -f $(DEV_COMPOSE_FILE) stop vllm
	docker compose -f $(DEV_COMPOSE_FILE) rm -f vllm
	docker compose -f $(DEV_COMPOSE_FILE) up -d vllm

menu-start-gateway:
	docker compose -f $(DEV_COMPOSE_FILE) stop gateway
	docker compose -f $(DEV_COMPOSE_FILE) rm -f gateway
	docker compose -f $(DEV_COMPOSE_FILE) up -d gateway

menu-start-postgres:
	docker compose -f $(DEV_COMPOSE_FILE) stop postgres
	docker compose -f $(DEV_COMPOSE_FILE) rm -f postgres
	docker compose -f $(DEV_COMPOSE_FILE) up -d postgres

menu-start-redis:
	docker compose -f $(DEV_COMPOSE_FILE) stop redis
	docker compose -f $(DEV_COMPOSE_FILE) rm -f redis
	docker compose -f $(DEV_COMPOSE_FILE) up -d redis

menu-build-all:
	docker compose -f $(DEV_COMPOSE_FILE) build

menu-build-frontend:
	docker compose -f $(DEV_COMPOSE_FILE) build frontend

menu-build-backend:
	docker compose -f $(DEV_COMPOSE_FILE) build backend

menu-build-ocr-service:
	docker compose -f $(DEV_COMPOSE_FILE) build ocr-service

menu-build-ocr-table-service:
	docker compose -f $(DEV_COMPOSE_FILE) build ocr-table-service

menu-build-docling-service:
	docker compose -f $(DEV_COMPOSE_FILE) build docling-service

menu-build-vllm:
	docker compose -f $(DEV_COMPOSE_FILE) build vllm

menu-build-gateway:
	docker compose -f $(DEV_COMPOSE_FILE) build gateway

menu-build-postgres:
	docker compose -f $(DEV_COMPOSE_FILE) build postgres

menu-build-redis:
	docker compose -f $(DEV_COMPOSE_FILE) build redis

menu-preload-all: menu-preload-ocr-table-layout menu-preload-ocr-table-structure menu-preload-ocr-table-all menu-preload-docling

menu-preload-ocr-table-layout:
	@echo "提示: 该命令需要联网，用于下载 detection 模型缓存。"
	$(MAKE) ocr-table-layout-model-cache-warm

menu-preload-ocr-table-structure:
	@echo "提示: 该命令需要联网，用于下载 structure+timm 模型缓存。"
	$(MAKE) ocr-table-model-cache-warm

menu-preload-ocr-table-all:
	@echo "提示: 该命令需要联网，用于下载 detection+structure+timm 模型缓存。"
	$(MAKE) ocr-table-cache-warm

menu-preload-docling:
	$(MAKE) docling-model-cache-warm
