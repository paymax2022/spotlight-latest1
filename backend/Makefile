# Backend developer tasks. Requires Go 1.25+.

.PHONY: build vet test test-fx run tidy fxsmoke

build:
	go build ./...

vet:
	go vet ./...

test:
	go test ./... -count=1

# Focused FX orchestration tests (no DB / network needed).
test-fx:
	go test ./internal/orchestration/... -count=1 -v

# Run the API, sourcing local secrets from .env (gitignored).
run:
	set -a; [ -f .env ] && . ./.env; set +a; go run ./cmd/server

tidy:
	go mod tidy

# Live provider validation against the configured sandbox (needs network + creds).
fxsmoke:
	set -a; [ -f .env ] && . ./.env; set +a; go run ./cmd/fxsmoke
