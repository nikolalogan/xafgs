.PHONY: help dev dev-fresh dev-rebuild-backend dev-rebuild-backend-fresh prod down dev-down prod-down logs ps

help:
	@echo "可用命令:"
	@echo "  make dev       # 开发模式启动（缓存重建+热更新）"
	@echo "  make dev-fresh # 开发模式启动（无缓存重建+热更新）"
	@echo "  make dev-rebuild-backend # 缓存重建开发后端镜像"
	@echo "  make dev-rebuild-backend-fresh # 无缓存重建开发后端镜像"
	@echo "  make prod      # 生产模式启动"
	@echo "  make down      # 停止开发+生产所有容器"
	@echo "  make dev-down  # 仅停止开发模式容器"
	@echo "  make prod-down # 仅停止生产模式容器"
	@echo "  make logs      # 查看开发模式日志"
	@echo "  make ps        # 查看容器状态"

dev: dev-rebuild-backend
	docker compose -f docker-compose.dev.yml up --build

dev-fresh: dev-rebuild-backend-fresh
	docker compose -f docker-compose.dev.yml up --build

dev-rebuild-backend:
	docker compose -f docker-compose.dev.yml build backend

dev-rebuild-backend-fresh:
	docker compose -f docker-compose.dev.yml build --no-cache backend

prod:
	docker compose up --build -d

down: dev-down prod-down

dev-down:
	docker compose -f docker-compose.dev.yml down

prod-down:
	docker compose down

logs:
	docker compose -f docker-compose.dev.yml logs -f

ps:
	docker compose -f docker-compose.dev.yml ps
	docker compose ps
