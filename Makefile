.PHONY: up down logs backend frontend watch build-all dev-setup

# Start all services via Docker Compose
up:
	docker compose up -d
	@echo "Backend: http://localhost:8080"
	@echo "Health:  http://localhost:8080/health"

# Stop all services
down:
	docker compose down

# Follow logs
logs:
	docker compose logs -f

# Rebuild and restart backend only
backend:
	docker compose up -d --build backend

# Run frontend dev server
frontend:
	cd frontend && npm run dev

# Install frontend deps
frontend-install:
	cd frontend && npm install

# Run backend locally (requires .env)
backend-local:
	cd backend && make dev

# Run full dev environment (docker postgres + local backend + local frontend)
dev:
	@echo "Starting PostgreSQL..."
	docker compose up -d postgres
	@echo "Starting backend..."
	cd backend && make dev &
	@echo "Starting frontend..."
	cd frontend && npm run dev

# First-time setup
dev-setup:
	@echo "Setting up MOB development environment..."
	@cp -n backend/.env.example backend/.env || true
	@cd frontend && npm install
	@echo "Done! Edit backend/.env with your credentials, then run: make up"

# Build all Docker images
build-all:
	docker compose build

# Database migration (applied via docker-compose initdb, but manual trigger here)
migrate:
	docker compose exec postgres psql -U mob_user -d mob_db -f /docker-entrypoint-initdb.d/001_initial.sql

# Watch app — must open in Android Studio
watch-open:
	@echo "Open /home/picoclaw/mob/watch/ in Android Studio to build the Watch app"
	@echo "Requires Android SDK with Wear OS support"
