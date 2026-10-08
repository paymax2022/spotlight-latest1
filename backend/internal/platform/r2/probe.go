package r2

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// probe.go — proves that the configured bucket, endpoint and token can actually
// write, instead of only that the variables are non-empty.
//
// Configured() checks presence, so a wrong bucket name, a token without write
// access, a mangled endpoint or a bad secret all presign happily (HTTP 200) and
// then fail at the client's PUT — where the app can only say "try again". The
// probe PUTs one tiny object through the same presigned-URL path a client uses,
// so any failure a real upload would hit is found here, classified, and can be
// logged and turned into a fail-closed 503 before a user is sent into a loop.

var (
	// ErrNoSuchBucket: the endpoint is reachable but the bucket does not exist
	// (wrong R2_BUCKET, or the bucket lives in another account).
	ErrNoSuchBucket = errors.New("r2: bucket does not exist")
	// ErrBadCredentials: the key id is unknown or the signature does not verify
	// (wrong key/secret, or an endpoint that is not this account's).
	ErrBadCredentials = errors.New("r2: access key or secret rejected")
	// ErrAccessDenied: the credentials are valid but may not write to the bucket
	// (a read-only API token).
	ErrAccessDenied = errors.New("r2: token cannot write to the bucket")
	// ErrUnreachable: the endpoint could not be contacted at all.
	ErrUnreachable = errors.New("r2: endpoint unreachable")
	// ErrProbeUnexpected: R2 answered with something this probe does not classify.
	ErrProbeUnexpected = errors.New("r2: unexpected response to the write probe")
)

const (
	probeKey        = "_healthcheck/probe.txt"
	probeType       = "text/plain"
	probeTimeout    = 5 * time.Second
	successTTL      = 10 * time.Minute // a bucket that worked keeps working
	failureTTL      = 30 * time.Second // retry soon so a fixed variable is picked up quickly
	probeBodyLimit  = 4 << 10
	probePresignTTL = time.Minute
)

var errorCodeRe = regexp.MustCompile(`<Code>([^<]+)</Code>`)

// Probe writes a one-line object to the bucket through a presigned URL and
// classifies the outcome. nil means a real upload would succeed.
func (p *Presigner) Probe(ctx context.Context, hc *http.Client) error {
	u, err := p.PresignPut(probeKey, probeType, probePresignTTL)
	if err != nil {
		return err
	}
	if hc == nil {
		hc = &http.Client{Timeout: probeTimeout}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, strings.NewReader("ok"))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrProbeUnexpected, err)
	}
	req.Header.Set("Content-Type", probeType)

	res, err := hc.Do(req)
	if err != nil {
		// The URL carries a signature in its query string; never echo it.
		return fmt.Errorf("%w: %s", ErrUnreachable, redactURLError(err))
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, probeBodyLimit))

	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	code := ""
	if m := errorCodeRe.FindSubmatch(body); m != nil {
		code = string(m[1])
	}
	switch code {
	case "NoSuchBucket":
		return fmt.Errorf("%w (status %d)", ErrNoSuchBucket, res.StatusCode)
	case "SignatureDoesNotMatch", "InvalidAccessKeyId":
		return fmt.Errorf("%w (%s, status %d)", ErrBadCredentials, code, res.StatusCode)
	case "AccessDenied":
		return fmt.Errorf("%w (status %d)", ErrAccessDenied, res.StatusCode)
	}
	return fmt.Errorf("%w (status %d, code %q)", ErrProbeUnexpected, res.StatusCode, code)
}

// redactURLError strips the request URL (which embeds the signature) from a
// transport error, keeping the cause.
func redactURLError(err error) string {
	var ue interface{ Unwrap() error }
	if errors.As(err, &ue) {
		if inner := ue.Unwrap(); inner != nil {
			return inner.Error()
		}
	}
	return "request failed"
}

// healthState is the cached outcome of the last Probe.
type healthState struct {
	mu       sync.Mutex
	enabled  bool
	hc       *http.Client
	checked  time.Time
	err      error
	hasCheck bool
}

// EnableHealthCheck opts this presigner into Healthy(). It is off by default so
// callers (and tests) that never asked for a network probe never get one.
func (p *Presigner) EnableHealthCheck(hc *http.Client) {
	p.health.mu.Lock()
	defer p.health.mu.Unlock()
	p.health.enabled = true
	p.health.hc = hc
}

// Healthy reports whether uploads through this presigner can work. When the
// health check is not enabled it returns nil without any network traffic.
// Otherwise it probes at most once per successTTL (once per failureTTL while
// failing), so a request burst costs one write, not one per request.
func (p *Presigner) Healthy(ctx context.Context) error {
	if p == nil {
		return ErrNotConfigured
	}
	h := &p.health
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.enabled {
		return nil
	}
	now := p.clock()
	if h.hasCheck {
		ttl := successTTL
		if h.err != nil {
			ttl = failureTTL
		}
		if now.Sub(h.checked) < ttl {
			return h.err
		}
	}
	pctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	h.err = p.Probe(pctx, h.hc)
	h.checked = now
	h.hasCheck = true
	return h.err
}

func (p *Presigner) clock() time.Time {
	if p.now != nil {
		return p.now()
	}
	return time.Now()
}
