package doctor

// routes_remaining.go is intentionally empty.
//
// It previously held RegisterRemaining + stubNotImplemented — a scaffold that
// registered HTTP 501 stubs for unbuilt doctor endpoints. Those symbols had ZERO
// call sites (RegisterRemaining was never wired in finance_routes.go) and their
// stub paths (e.g. GET /chat/threads, POST /chat/:threadId/messages, GET/POST
// /hmo/claims, /vet/dashboard) now DUPLICATE the real routes registered across
// Waves MVP–6. Wiring the stubs would panic gin with "duplicate route".
//
// The dead code has been removed. The file is kept (emptied to just this package
// clause) because deletion is blocked by the brownfield protection / read-only
// mount; an empty file with only the package declaration compiles cleanly and
// introduces no symbols.
