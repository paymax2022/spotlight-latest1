package app

// Unit tests for the academy webhook outbox/redrive (AUD-BE-013 residual).
// These run WITHOUT TEST_DATABASE_URL: an in-memory academyOutboxStore and a
// fake railLedger drive the enqueue → redrive → post-once invariant. The
// end-to-end HTTP path (real dedupe table + real pgx store + real ledger) is
// covered by TestAcademyRailWebhook_TransientPostJournalOutboxRedrive_* in
// academy_webhooks_live_db_test.go.

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// memAcademyOutbox is the in-memory academyOutboxStore for unit tests.
type memAcademyOutbox struct {
	mu   sync.Mutex
	seq  int
	rows map[string]*memOutboxEntry // by id
}

type memOutboxEntry struct {
	row    academyOutboxRow
	status string
}

func newMemAcademyOutbox() *memAcademyOutbox {
	return &memAcademyOutbox{rows: map[string]*memOutboxEntry{}}
}

func (m *memAcademyOutbox) Enqueue(_ context.Context, r academyOutboxRow) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range m.rows {
		if e.row.Rail == r.Rail && e.row.ProviderRef == r.ProviderRef {
			return nil // ON CONFLICT (rail, provider_ref) DO NOTHING
		}
	}
	m.seq++
	r.ID = fmt.Sprintf("ob-%d", m.seq)
	r.NextRetryAt = time.Now() // mirrors the column DEFAULT now()
	m.rows[r.ID] = &memOutboxEntry{row: r, status: "pending"}
	return nil
}

func (m *memAcademyOutbox) Due(_ context.Context, rail, providerRef string, limit int) ([]academyOutboxRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []academyOutboxRow
	for _, e := range m.rows {
		if e.status != "pending" || e.row.NextRetryAt.After(time.Now()) {
			continue
		}
		if e.row.Rail != rail {
			continue
		}
		if providerRef != "" && e.row.ProviderRef != providerRef {
			continue
		}
		out = append(out, e.row)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (m *memAcademyOutbox) Complete(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.rows[id]; ok && e.status == "pending" {
		e.status = "posted"
	}
	return nil
}

func (m *memAcademyOutbox) Fail(_ context.Context, id string, attempts int, nextRetryAt time.Time, lastErr string, exhausted bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.rows[id]
	if !ok || e.status != "pending" {
		return nil
	}
	e.row.Attempts = attempts
	e.row.NextRetryAt = nextRetryAt
	e.row.LastError = lastErr
	if exhausted {
		e.status = "exhausted"
	}
	return nil
}

// forceDue rewinds every pending row's next_retry_at — the test's stand-in for
// "the backoff delay has elapsed".
func (m *memAcademyOutbox) forceDue() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range m.rows {
		e.row.NextRetryAt = time.Now().Add(-time.Second)
	}
}

func (m *memAcademyOutbox) statusOf(rail, providerRef string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range m.rows {
		if e.row.Rail == rail && e.row.ProviderRef == providerRef {
			return e.status
		}
	}
	return ""
}

func (m *memAcademyOutbox) pendingCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, e := range m.rows {
		if e.status == "pending" {
			n++
		}
	}
	return n
}

// fakeRailLedger records successful posts and injects failures on demand.
type fakeRailLedger struct {
	mu      sync.Mutex
	calls   int                   // every PostJournal invocation
	posts   []ledger.JournalEntry // successful posts only
	err     error                 // returned on EVERY call while set
	failOne bool                  // fail exactly the next call
}

func (f *fakeRailLedger) GetOrCreateStandingAccount(_ context.Context, t ledger.AccountType) (*ledger.Account, error) {
	return &ledger.Account{ID: "standing-" + string(t), Type: t}, nil
}

func (f *fakeRailLedger) PostJournal(_ context.Context, j ledger.JournalEntry) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return f.err
	}
	if f.failOne {
		f.failOne = false
		return errors.New("transient postjournal failure")
	}
	f.posts = append(f.posts, j)
	return nil
}

func (f *fakeRailLedger) postCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.posts)
}

// The core invariant: a transient PostJournal failure parks a pending outbox
// row, and a later redrive posts the escrow→settlement leg exactly once with
// the original deterministic idempotency key.
func TestAcademyWebhookOutbox_TransientFailureRedrivePostsOnce(t *testing.T) {
	ctx := context.Background()
	store := newMemAcademyOutbox()
	lg := &fakeRailLedger{}
	h := &academyWebhookHandler{ledger: lg, outbox: store}

	evt := academyWebhookEvent{Ref: "payout-ref-1", Reference: "RP-1"}
	h.enqueueOutbox(ctx, "payout", evt, 50000, errors.New("postjournal: connection reset"))

	if n := store.pendingCount(); n != 1 {
		t.Fatalf("pending outbox rows = %d, want 1", n)
	}

	h.redrivePending(ctx, "payout", "")
	if got := lg.postCount(); got != 1 {
		t.Fatalf("ledger posts = %d, want 1", got)
	}
	j := lg.posts[0]
	if j.IdempotencyKey != "academy-rail:payout:payout-ref-1" {
		t.Fatalf("idempotency key = %q, want academy-rail:payout:payout-ref-1", j.IdempotencyKey)
	}
	if j.AmountKobo != 50000 {
		t.Fatalf("amount = %d, want 50000", j.AmountKobo)
	}
	if j.DebitAccountID != "standing-escrow" || j.CreditAccountID != "standing-settlement" {
		t.Fatalf("legs = %s→%s, want standing-escrow→standing-settlement", j.DebitAccountID, j.CreditAccountID)
	}
	if s := store.statusOf("payout", "payout-ref-1"); s != "posted" {
		t.Fatalf("outbox status = %q, want posted", s)
	}

	// Further sweeps (rail-wide AND same-ref) must not re-post: exactly once.
	h.redrivePending(ctx, "payout", "")
	h.redrivePending(ctx, "payout", "payout-ref-1")
	if got := lg.postCount(); got != 1 {
		t.Fatalf("ledger posts after extra sweeps = %d, want 1 (leg re-posted)", got)
	}
}

// A failed redrive attempt backs off and does not retry until due; once due,
// the retry succeeds and completes the row.
func TestAcademyWebhookOutbox_FailedAttemptBacksOffUntilDue(t *testing.T) {
	ctx := context.Background()
	store := newMemAcademyOutbox()
	lg := &fakeRailLedger{failOne: true}
	h := &academyWebhookHandler{ledger: lg, outbox: store}

	evt := academyWebhookEvent{Ref: "payout-ref-2", Reference: "RP-2"}
	h.enqueueOutbox(ctx, "payout", evt, 50000, errors.New("postjournal: timeout"))

	h.redrivePending(ctx, "payout", "")
	if lg.calls != 1 {
		t.Fatalf("post attempts = %d, want 1", lg.calls)
	}
	if s := store.statusOf("payout", "payout-ref-2"); s != "pending" {
		t.Fatalf("status after failed attempt = %q, want pending", s)
	}

	// Backed off — not due yet, so the sweep is a no-op.
	h.redrivePending(ctx, "payout", "")
	if lg.calls != 1 {
		t.Fatalf("post attempts before backoff elapsed = %d, want 1 (no retry while backed off)", lg.calls)
	}

	store.forceDue()
	h.redrivePending(ctx, "payout", "")
	if lg.calls != 2 || lg.postCount() != 1 {
		t.Fatalf("after due: calls=%d posts=%d, want calls=2 posts=1", lg.calls, lg.postCount())
	}
	if s := store.statusOf("payout", "payout-ref-2"); s != "posted" {
		t.Fatalf("status = %q, want posted", s)
	}
}

// Retries are bounded: a permanently-failing leg exhausts and parks for manual
// repair instead of retrying forever.
func TestAcademyWebhookOutbox_ExhaustsAfterMaxAttempts(t *testing.T) {
	ctx := context.Background()
	store := newMemAcademyOutbox()
	lg := &fakeRailLedger{err: errors.New("ledger down")}
	h := &academyWebhookHandler{ledger: lg, outbox: store}

	evt := academyWebhookEvent{Ref: "payout-ref-3", Reference: "RP-3"}
	h.enqueueOutbox(ctx, "payout", evt, 50000, errors.New("postjournal: down"))

	for range academyOutboxMaxAttempts {
		store.forceDue()
		h.redrivePending(ctx, "payout", "")
	}
	if s := store.statusOf("payout", "payout-ref-3"); s != "exhausted" {
		t.Fatalf("status = %q, want exhausted after %d attempts", s, academyOutboxMaxAttempts)
	}
	if lg.calls != academyOutboxMaxAttempts {
		t.Fatalf("post attempts = %d, want %d", lg.calls, academyOutboxMaxAttempts)
	}

	// An exhausted row is never redriven again.
	store.forceDue()
	h.redrivePending(ctx, "payout", "")
	if lg.calls != academyOutboxMaxAttempts {
		t.Fatalf("post attempts after exhaustion = %d, want %d (exhausted row retried)", lg.calls, academyOutboxMaxAttempts)
	}
}

// ErrDuplicate from the ledger means the leg already landed — the row
// completes instead of retrying.
func TestAcademyWebhookOutbox_DuplicateKeyMarksPosted(t *testing.T) {
	ctx := context.Background()
	store := newMemAcademyOutbox()
	lg := &fakeRailLedger{err: ledger.ErrDuplicate}
	h := &academyWebhookHandler{ledger: lg, outbox: store}

	evt := academyWebhookEvent{Ref: "payout-ref-4", Reference: "RP-4"}
	h.enqueueOutbox(ctx, "payout", evt, 50000, errors.New("postjournal: ambiguous"))

	h.redrivePending(ctx, "payout", "")
	if lg.calls != 1 {
		t.Fatalf("post attempts = %d, want 1", lg.calls)
	}
	if s := store.statusOf("payout", "payout-ref-4"); s != "posted" {
		t.Fatalf("status = %q, want posted (ErrDuplicate ⇒ leg exists)", s)
	}
}

// The dedupe-hit path redrives ONLY the matching (rail, ref) row — other rails'
// and other refs' parked legs are untouched.
func TestAcademyWebhookOutbox_DedupeHitRedrivesOnlyThatRef(t *testing.T) {
	ctx := context.Background()
	store := newMemAcademyOutbox()
	lg := &fakeRailLedger{}
	h := &academyWebhookHandler{ledger: lg, outbox: store}

	h.enqueueOutbox(ctx, "payout", academyWebhookEvent{Ref: "ref-A", Reference: "RA"}, 100, errors.New("x"))
	h.enqueueOutbox(ctx, "payout", academyWebhookEvent{Ref: "ref-B", Reference: "RB"}, 200, errors.New("x"))
	h.enqueueOutbox(ctx, "disburse", academyWebhookEvent{Ref: "ref-A", Reference: "RD"}, 300, errors.New("x"))

	h.redrivePending(ctx, "payout", "ref-A")
	if lg.postCount() != 1 {
		t.Fatalf("posts = %d, want 1 (only payout:ref-A)", lg.postCount())
	}
	if lg.posts[0].IdempotencyKey != "academy-rail:payout:ref-A" {
		t.Fatalf("posted key = %q, want academy-rail:payout:ref-A", lg.posts[0].IdempotencyKey)
	}
	if s := store.statusOf("payout", "ref-B"); s != "pending" {
		t.Fatalf("payout:ref-B status = %q, want pending", s)
	}
	if s := store.statusOf("disburse", "ref-A"); s != "pending" {
		t.Fatalf("disburse:ref-A status = %q, want pending (different rail)", s)
	}
}

// Enqueue is idempotent on (rail, provider_ref) — the dedupe table's mirror.
func TestAcademyWebhookOutbox_EnqueueIdempotent(t *testing.T) {
	ctx := context.Background()
	store := newMemAcademyOutbox()
	h := &academyWebhookHandler{ledger: &fakeRailLedger{}, outbox: store}

	evt := academyWebhookEvent{Ref: "ref-C", Reference: "RC"}
	h.enqueueOutbox(ctx, "payout", evt, 50000, errors.New("first"))
	h.enqueueOutbox(ctx, "payout", evt, 50000, errors.New("second"))
	if n := store.pendingCount(); n != 1 {
		t.Fatalf("pending rows = %d, want 1 (duplicate enqueue must not double-park)", n)
	}
}
