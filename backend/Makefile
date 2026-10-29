# Backend developer tasks. Requires Go 1.25+.

# GNU Make on Windows cannot use a SHELL path containing spaces — it falls back
# to cmd.exe, which cannot run the POSIX recipes below ("Environment variable
# -a; ... not defined"). Use Git's sh through its 8.3 short path, which has no
# spaces. On Unix these wildcards match nothing and the default shell is kept.
GIT_SH := $(wildcard C:/PROGRA~1/Git/bin/sh.exe)
ifeq ($(strip $(GIT_SH)),)
GIT_SH := $(wildcard C:/PROGRA~1/Git/usr/bin/sh.exe)
endif
ifeq ($(strip $(GIT_SH)),)
GIT_SH := $(wildcard C:/PROGRA~2/Git/bin/sh.exe)
endif
ifeq ($(strip $(GIT_SH)),)
GIT_SH := $(wildcard C:/PROGRA~2/Git/usr/bin/sh.exe)
endif
ifneq ($(strip $(GIT_SH)),)
SHELL := $(GIT_SH)
endif

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
