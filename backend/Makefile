.PHONY: run build test migrate lint tidy docker-build

APP_NAME=mob-backend
BINARY=./bin/$(APP_NAME)
MAIN=./cmd/server/main.go

run:
	go run $(MAIN)

build:
	go build -o $(BINARY) $(MAIN)

test:
	go test ./... -v -race

lint:
	golangci-lint run ./...

tidy:
	go mod tidy

migrate:
	psql "$(DATABASE_URL)" -f migrations/001_initial.sql

migrate-local:
	psql "postgres://mob_user:mob_password@localhost:5432/mob_db" -f migrations/001_initial.sql

docker-build:
	docker build -t $(APP_NAME):latest .

dev:
	DATABASE_URL=postgres://mob_user:mob_password@localhost:5432/mob_db \
	JWT_SECRET=dev-secret-please-change \
	GOOGLE_CLIENT_ID=placeholder \
	GOOGLE_CLIENT_SECRET=placeholder \
	go run $(MAIN)
