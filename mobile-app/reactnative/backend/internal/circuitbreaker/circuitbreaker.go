// Package circuitbreaker provides a simple, stdlib-only circuit breaker.
//
// The breaker has three states:
//
//   - closed:    calls pass through; consecutive failures are counted and
//                trip the breaker to open once FailureThreshold is reached.
//   - open:      calls fail fast with ErrOpen until OpenTimeout elapses, after
//                which the breaker transitions to half-open.
//   - half-open: a limited number of trial calls (HalfOpenMax) are allowed
//                through. A single trial success closes the breaker; a single
//                trial failure re-opens it. While trials are exhausted but no
//                result has come back, further calls fail fast with ErrOpen.
package circuitbreaker

import (
	"errors"
	"sync"
	"time"
)

// ErrOpen is returned when a call is rejected because the breaker is open
// (or half-open with no remaining trial slots).
var ErrOpen = errors.New("circuit breaker open")

type state int

const (
	stateClosed state = iota
	stateOpen
	stateHalfOpen
)

// Config configures a Breaker. Zero-valued fields fall back to sane defaults
// (see New).
type Config struct {
	// FailureThreshold is the number of consecutive failures in the closed
	// state that trips the breaker to open. Default: 5.
	FailureThreshold int
	// OpenTimeout is how long the breaker stays open before allowing trial
	// calls in the half-open state. Default: 30s.
	OpenTimeout time.Duration
	// HalfOpenMax is the maximum number of trial calls permitted while
	// half-open. Default: 1.
	HalfOpenMax int
}

// Breaker is a concurrency-safe circuit breaker. The zero value is not usable;
// construct one with New.
type Breaker struct {
	cfg Config

	mu       sync.Mutex
	state    state
	failures int       // consecutive failures while closed
	openedAt time.Time // when the breaker last tripped to open

	// half-open bookkeeping
	halfOpenInFlight int // trial calls currently allowed/dispatched
}

// New returns a Breaker configured with cfg, applying defaults for any
// zero-valued field.
func New(cfg Config) *Breaker {
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = 5
	}
	if cfg.OpenTimeout <= 0 {
		cfg.OpenTimeout = 30 * time.Second
	}
	if cfg.HalfOpenMax <= 0 {
		cfg.HalfOpenMax = 1
	}
	return &Breaker{cfg: cfg, state: stateClosed}
}

// Do executes fn under the protection of the breaker.
//
// Concurrency note: the mutex is held while inspecting/updating breaker state
// to decide whether the call may proceed, then released around the fn() call
// (so long-running work does not serialize on the breaker), then re-acquired
// to record the result. This means state transitions are atomic but fn itself
// runs without the lock held.
func (b *Breaker) Do(fn func() error) error {
	allowed, trial, err := b.beforeCall()
	if !allowed {
		return err
	}

	callErr := fn()

	b.afterCall(trial, callErr)
	return callErr
}

// beforeCall decides whether a call may proceed. It returns allowed=false with
// ErrOpen when the call must fail fast. When allowed, trial reports whether the
// call is a half-open trial (which uses distinct result accounting).
func (b *Breaker) beforeCall() (allowed bool, trial bool, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case stateClosed:
		return true, false, nil

	case stateOpen:
		if time.Since(b.openedAt) < b.cfg.OpenTimeout {
			return false, false, ErrOpen
		}
		// Timeout elapsed: move to half-open and reset trial counters.
		b.state = stateHalfOpen
		b.halfOpenInFlight = 0
		fallthrough

	case stateHalfOpen:
		if b.halfOpenInFlight >= b.cfg.HalfOpenMax {
			return false, false, ErrOpen
		}
		b.halfOpenInFlight++
		return true, true, nil

	default:
		return false, false, ErrOpen
	}
}

// afterCall records the result of a completed call.
func (b *Breaker) afterCall(trial bool, callErr error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if trial {
		// Result of a half-open trial. The state may already have changed if
		// another goroutine's trial resolved first; only act while half-open.
		if b.state != stateHalfOpen {
			return
		}
		if callErr != nil {
			b.trip()
			return
		}
		b.reset()
		return
	}

	// Closed-state result.
	if b.state != stateClosed {
		return
	}
	if callErr != nil {
		b.failures++
		if b.failures >= b.cfg.FailureThreshold {
			b.trip()
		}
		return
	}
	// Success in closed state resets the failure count.
	b.failures = 0
}

// trip moves the breaker to the open state. Caller must hold b.mu.
func (b *Breaker) trip() {
	b.state = stateOpen
	b.openedAt = time.Now()
	b.failures = 0
	b.halfOpenInFlight = 0
}

// reset closes the breaker and clears all counters. Caller must hold b.mu.
func (b *Breaker) reset() {
	b.state = stateClosed
	b.failures = 0
	b.halfOpenInFlight = 0
}

// State returns the current breaker state for observability: one of
// "closed", "open", or "half-open".
func (b *Breaker) State() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case stateOpen:
		return "open"
	case stateHalfOpen:
		return "half-open"
	default:
		return "closed"
	}
}
