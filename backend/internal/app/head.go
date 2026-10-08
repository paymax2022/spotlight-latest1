package app

import "net/http"

// HEADAsGet lets HEAD requests reuse the GET-matched handler.
//
// Gin keys its route table on r.Method at lookup time, so a .GET(...) mount
// alone 404s HEAD probes (uptime monitors, the BFF's forwarded HEAD checks).
// A gin middleware CANNOT fix this — middleware runs after route matching —
// so the rewrite wraps the engine above ServeHTTP, at the http.Server
// Handler boundary in cmd/server.
//
// The request is shallow-COPIED, never mutated in place: net/http keeps its
// own *http.Request pointer (response.req is the very request handed to the
// handler) and eats written body bytes only while that pointer's Method is
// still "HEAD" (chunkWriter.Write / writeHeader in net/http/server.go).
// Setting r.Method = "GET" in place would silently put the GET body on the
// wire for a HEAD request — a protocol violation.
func HEADAsGet(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			r2 := new(http.Request)
			*r2 = *r
			r2.Method = http.MethodGet
			r = r2
		}
		next.ServeHTTP(w, r)
	})
}
