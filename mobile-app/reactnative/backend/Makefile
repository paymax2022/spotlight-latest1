# Paymax Invest · Crypto backend
.PHONY: run build test vet tidy check

run:    ## start the API on :8080 (override with PORT=xxxx)
	go run ./cmd/server

build:  ## compile the server binary into ./bin
	go build -o bin/crypto-service ./cmd/server

test:   ## run the unit tests
	go test ./... -count=1

vet:    ## static analysis
	go vet ./...

tidy:   ## sync go.mod (no external deps expected)
	go mod tidy

check: vet test build ## full local gate: vet + test + build
