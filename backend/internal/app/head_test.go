package app

// HEAD probes 404'd on every GET-only route: Gin keys its route table on
// r.Method (prod sweep: uptime monitors + the BFF's forwarded HEAD checks).
// HEADAsGet rewrites the method for routing while net/http still suppresses
// the body — which requires a REAL server: httptest.NewRecorder has no
// chunkWriter, and http.Client treats a HEAD response body as empty either
// way, so neither can observe body bytes leaking onto the wire. The wire
// assertion below therefore dials raw TCP.

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func newHeadTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/ping", func(c *gin.Context) {
		c.Header("X-Route", "ping")
		c.String(http.StatusOK, "pong-body-must-not-leak")
	})
	// POST-only sibling: proves the rewrite does not over-match — HEAD on a
	// path with no GET mount must still 404, not fall through to POST.
	r.POST("/post-only", func(c *gin.Context) { c.Status(http.StatusCreated) })

	srv := httptest.NewServer(HEADAsGet(r))
	t.Cleanup(srv.Close)
	return srv
}

// rawHTTPRequest writes one HTTP/1.1 request over a real socket and returns
// the entire raw response — the only way to see bytes the client library
// would politely hide for HEAD.
func rawHTTPRequest(t *testing.T, addr, request string) string {
	t.Helper()
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if _, err := fmt.Fprint(conn, request); err != nil {
		t.Fatalf("write: %v", err)
	}
	raw, err := io.ReadAll(bufio.NewReader(conn))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return string(raw)
}

func TestHEADAsGet_GETRouteAnswersHEADWithEmptyWireBody(t *testing.T) {
	srv := newHeadTestServer(t)
	addr := strings.TrimPrefix(srv.URL, "http://")

	// GET baseline for parity comparison.
	getResp, err := http.Get(srv.URL + "/ping")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	getBody, err := io.ReadAll(getResp.Body)
	getResp.Body.Close()
	if err != nil {
		t.Fatalf("GET body: %v", err)
	}
	if getResp.StatusCode != http.StatusOK || string(getBody) != "pong-body-must-not-leak" {
		t.Fatalf("GET baseline broken: status=%d body=%q", getResp.StatusCode, getBody)
	}

	// HEAD over raw TCP with Connection: close — everything the server sends
	// lands in `raw`, so any leaked body would be visible after the blank line.
	raw := rawHTTPRequest(t, addr,
		"HEAD /ping HTTP/1.1\r\nHost: "+addr+"\r\nConnection: close\r\n\r\n")

	head, tail, found := strings.Cut(raw, "\r\n\r\n")
	if !found {
		t.Fatalf("malformed HTTP response: %q", raw)
	}
	if !strings.HasPrefix(head, "HTTP/1.1 200 OK") {
		t.Fatalf("HEAD status line = %q, want 200 (route table must match as GET)", head)
	}
	if !strings.Contains(head, "X-Route: ping") {
		t.Errorf("HEAD lost handler headers: %q", head)
	}
	// Content-Length parity with GET: per RFC a HEAD response carries the
	// headers GET would have sent, so monitors see the real payload size.
	wantCL := fmt.Sprintf("Content-Length: %d", len(getBody))
	if !strings.Contains(head, wantCL) {
		t.Errorf("HEAD headers missing %q: %q", wantCL, head)
	}
	if tail != "" {
		t.Fatalf("HEAD leaked %d body bytes on the wire: %q", len(tail), tail)
	}

	// Same result through the standard client (status + headers parity).
	headResp, err := http.Head(srv.URL + "/ping")
	if err != nil {
		t.Fatalf("HEAD client: %v", err)
	}
	headResp.Body.Close()
	if headResp.StatusCode != http.StatusOK || headResp.Header.Get("X-Route") != "ping" {
		t.Fatalf("HEAD client response: status=%d X-Route=%q", headResp.StatusCode, headResp.Header.Get("X-Route"))
	}
	if headResp.ContentLength != int64(len(getBody)) {
		t.Errorf("HEAD Content-Length = %d, want %d (GET parity)", headResp.ContentLength, len(getBody))
	}
}

func TestHEADAsGet_NoGETMountStill404s(t *testing.T) {
	srv := newHeadTestServer(t)

	resp, err := http.Head(srv.URL + "/post-only")
	if err != nil {
		t.Fatalf("HEAD: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("HEAD /post-only = %d, want 404 (rewrite must not match POST routes)", resp.StatusCode)
	}

	// And non-HEAD methods pass through untouched.
	post, err := http.Post(srv.URL+"/post-only", "text/plain", nil)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	post.Body.Close()
	if post.StatusCode != http.StatusCreated {
		t.Fatalf("POST /post-only = %d, want 201", post.StatusCode)
	}
}
