package email

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"time"
)

// OTPSender is the narrow shape SendWithRetry needs. It is declared here (rather
// than importing the otp package) so email has no dependency on its consumer.
type OTPSender interface {
	SendOTP(ctx context.Context, to, name, code string, ttl time.Duration) error
}

// SendWithRetry retries TRANSIENT failures only, up to three attempts total.
//
// Two properties matter more than the retry itself:
//
//   - A permanent failure returns immediately. Retrying a revoked key or a
//     refused address cannot succeed and, on a rate-limited account, makes the
//     underlying condition worse.
//   - The total is bounded by ctx. The caller is a user waiting on an HTTP
//     response, so the backoff sleeps select on ctx.Done() rather than blocking
//     past the request deadline.
//
// Jitter comes from crypto/rand for the same reason the codes do: math/rand's
// global source is seeded deterministically in some Go configurations, and
// synchronised retries across a fleet are precisely what jitter exists to avoid.
func SendWithRetry(ctx context.Context, s OTPSender, to, name, code string, ttl time.Duration) error {
	const attempts = 3
	var err error
	for i := 0; i < attempts; i++ {
		err = s.SendOTP(ctx, to, name, code, ttl)
		if err == nil {
			return nil
		}
		if !errors.Is(err, ErrTransient) {
			return err
		}
		if i == attempts-1 {
			break // no point sleeping before giving up
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff(i)):
		}
	}
	return err
}

// backoff returns 200ms, 400ms, … doubling per attempt, plus up to 150ms jitter.
func backoff(attempt int) time.Duration {
	base := time.Duration(1<<attempt) * 200 * time.Millisecond
	n, err := rand.Int(rand.Reader, big.NewInt(150))
	if err != nil {
		return base
	}
	return base + time.Duration(n.Int64())*time.Millisecond
}
