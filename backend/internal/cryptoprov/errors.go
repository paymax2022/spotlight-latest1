package cryptoprov

import (
	"context"
	"errors"
	"fmt"
	"net/http"
)

// APIError is a provider HTTP error.
type APIError struct {
	Provider string
	Status   int
	Code     string
	Message  string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("%s: HTTP %d %s: %s", e.Provider, e.Status, e.Code, e.Message)
}

// IsDefinitive reports whether a provider error proves the action did NOT execute,
// so the caller may safely release any hold and report failure.
//
// Only a client error (4xx) is definitive. Timeouts, dropped connections and 5xx
// are ambiguous: the provider may have executed the action. Callers must park
// such results as needs_review and never blindly retry a value-moving call.
func IsDefinitive(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.Status >= 400 && apiErr.Status < 500
}

// IsRateLimited reports whether the provider refused the call for rate reasons
// (HTTP 429, or Quidax's 444). The call did not execute, so it is safe to retry
// after backoff.
func IsRateLimited(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.Status == http.StatusTooManyRequests || apiErr.Status == 444
}

// IsAmbiguous reports whether the outcome is unknown: the action may or may not
// have executed. This is the inverse of a definitive rejection for call errors.
func IsAmbiguous(err error) bool {
	if err == nil {
		return false
	}
	return !IsDefinitive(err)
}

// IsCanceled reports a caller-side cancellation, which says nothing about the provider.
func IsCanceled(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// ErrAddressPending means the provider is still generating a deposit address. It is not a
// failure: ask again shortly (providers generate some addresses asynchronously).
var ErrAddressPending = errors.New("cryptoprov: deposit address is still being generated")
