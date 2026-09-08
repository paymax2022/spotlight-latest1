package email

import "errors"

// Transient and permanent failures are separated because the correct response to
// each is opposite. A 429 or a 502 is worth retrying — the message would have
// been accepted a moment later. A 401 from a revoked key, or a 400 from an
// address the provider refuses, will fail identically every time; retrying it
// spends the caller's request budget and the user's patience for nothing, and on
// a rate-limited account it makes the underlying condition worse.
//
// Callers classify with errors.Is, never by string matching on the message.
var (
	ErrTransient = errors.New("email: transient delivery failure")
	ErrPermanent = errors.New("email: permanent delivery failure")
)
