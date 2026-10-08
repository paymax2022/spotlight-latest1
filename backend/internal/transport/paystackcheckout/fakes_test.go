package paystackcheckout

// Shared in-memory fakes for the pure engine tests. The fake STORE enforces the
// same fence/transition rules the SQL does, so a pure test that passes here is
// exercising the engine's use of the contract, not the fake's leniency.

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
)

// events is an ordered, shared log so tests can assert cross-component order
// (e.g. ledger reversal BEFORE gateway refund).
type events struct {
	mu sync.Mutex
	e  []string
}

func (l *events) add(s string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.e = append(l.e, s)
}

func (l *events) list() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.e...)
}

// ── gateway ─────────────────────────────────────────────────────────────────

type fakeGW struct {
	mu           sync.Mutex
	ev           *events
	initCalls    []provider.InitializePaymentRequest
	initErr      error
	initErrAfter int // fail InitializePayment from the Nth call on (1-based); 0 = use initErr always
	verify       *provider.PaymentStatus
	verifyErr    error
	refundErr    error
	refundRes    *provider.RefundResult // overrides the default processed result
	refundCalls  []int64
	refundedRefs []string
	// onRefund runs inside RefundPayment, before it returns (assert store state at call time).
	onRefund func(ref string)

	lookupRes   *provider.RefundResult
	lookupErr   error
	lookupCalls int32

	// ── partial refunds ────────────────────────────────────────────────────
	// pRefunds is the gateway's ACTUAL refund list for the transaction (the
	// truth LookupRefunds reports). Tests pre-seed it to model a crash after the
	// gateway accepted a refund, or an unexplained dashboard refund.
	pRefunds []provider.RefundResult
	pCalls   []partialCall
	pErr     error // RefundPaymentNoted returns this
	// pAcceptOnErr: the refund IS recorded at the gateway although the call
	// returned pErr (a lost reply).
	pAcceptOnErr    bool
	pFailed         bool   // the gateway answers the request with a failed refund
	pStatus         string // status of a newly created refund (default processed)
	pEcho           bool   // echo the merchant note back in LookupRefunds
	pAmountOverride int64  // reply reports a different amount than asked
	// pFailedOnErr: when RefundPaymentNoted returns pErr the gateway ALSO lists a
	// FAILED refund carrying the note (so a lookup proves the attempt failed).
	pFailedOnErr bool
	pListErr     error
	pOnRefund    func(ref string, amt int64)
	pListCalls   int32
}

type partialCall struct {
	Ref  string
	Amt  int64
	Note string
}

func (g *fakeGW) InitializePayment(_ context.Context, r provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.initCalls = append(g.initCalls, r)
	if g.initErr != nil && (g.initErrAfter == 0 || len(g.initCalls) >= g.initErrAfter) {
		return nil, g.initErr
	}
	return &provider.InitializePaymentResponse{Reference: r.Reference, AuthorizationURL: "https://paystack.test/ac_" + r.Reference, AccessCode: "ac_1"}, nil
}

func (g *fakeGW) VerifyPayment(_ context.Context, ref string) (*provider.PaymentStatus, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.verify == nil || g.verifyErr != nil {
		return g.verify, g.verifyErr
	}
	cp := *g.verify
	if cp.Reference == "" {
		cp.Reference = ref // a real gateway echoes the reference it was asked about
	}
	return &cp, nil
}

func (g *fakeGW) RefundPayment(_ context.Context, ref string, amt int64) (*provider.RefundResult, error) {
	g.mu.Lock()
	hook := g.onRefund
	g.refundCalls = append(g.refundCalls, amt)
	g.refundedRefs = append(g.refundedRefs, ref)
	err, res := g.refundErr, g.refundRes
	g.mu.Unlock()
	g.ev.add("gateway.refund")
	if hook != nil {
		hook(ref)
	}
	if err != nil {
		return nil, err
	}
	if res != nil {
		return res, nil
	}
	return &provider.RefundResult{Reference: "rf_" + ref, Status: "processed", AmountKobo: amt}, nil
}

func (g *fakeGW) LookupRefund(_ context.Context, ref string) (*provider.RefundResult, error) {
	atomic.AddInt32(&g.lookupCalls, 1)
	g.ev.add("gateway.lookup")
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.lookupRes, g.lookupErr
}

func (g *fakeGW) RefundPaymentNoted(_ context.Context, ref string, amt int64, note string) (*provider.RefundResult, error) {
	g.mu.Lock()
	hook := g.pOnRefund
	g.pCalls = append(g.pCalls, partialCall{ref, amt, note})
	n := len(g.pCalls)
	g.mu.Unlock()
	g.ev.add("gateway.refund.partial")
	if hook != nil {
		hook(ref, amt)
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	status := g.pStatus
	if status == "" {
		status = "processed"
	}
	rec := func(st string) provider.RefundResult {
		r := provider.RefundResult{Reference: ref, Status: st, AmountKobo: amt, ID: "gw-" + strconv.Itoa(n)}
		if g.pEcho {
			r.Note = note
		}
		return r
	}
	if g.pFailed {
		g.pRefunds = append(g.pRefunds, rec("failed"))
		return nil, provider.ErrRefundFailed
	}
	if g.pErr != nil {
		if g.pAcceptOnErr {
			g.pRefunds = append(g.pRefunds, rec(status))
		}
		if g.pFailedOnErr {
			g.pRefunds = append(g.pRefunds, rec("failed"))
		}
		return nil, g.pErr
	}
	r := rec(status)
	g.pRefunds = append(g.pRefunds, r)
	if g.pAmountOverride != 0 {
		r.AmountKobo = g.pAmountOverride
	}
	return &r, nil
}

func (g *fakeGW) LookupRefunds(_ context.Context, _ string) ([]provider.RefundResult, error) {
	atomic.AddInt32(&g.pListCalls, 1)
	g.ev.add("gateway.lookupAll")
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.pListErr != nil {
		return nil, g.pListErr
	}
	return append([]provider.RefundResult(nil), g.pRefunds...), nil
}

// ── ledger / settlement ─────────────────────────────────────────────────────

type fakeLedger struct {
	mu    sync.Mutex
	ev    *events
	calls []string // RefundExternal: "<id>|<reason>"
	err   error
	// byKey: ReverseByKey calls ("<key>|<reason>")
	byKey    []string
	byKeyErr error
	// setts overrides the settlement GetByID returns (by id). Default: a healthy
	// escrowed external settlement bound to the standard test intent.
	setts   map[string]*settlement.Settlement
	getErr  error
	getHits int32
}

func (l *fakeLedger) RefundExternal(_ context.Context, id, reason string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls = append(l.calls, id+"|"+reason)
	l.ev.add("ledger.refund")
	if l.err != nil {
		return l.err
	}
	if s, ok := l.setts[id]; ok && (s.Status == settlement.StatusEscrowed || s.Status == settlement.StatusDisputed) {
		s.Status = settlement.StatusRefunded
	}
	return nil
}

func (l *fakeLedger) RefundExternalByKeyPrefix(_ context.Context, key, reason string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.byKey = append(l.byKey, key+"|"+reason)
	l.ev.add("ledger.reverseByKey")
	return l.byKeyErr
}

func (l *fakeLedger) GetByID(_ context.Context, id string) (*settlement.Settlement, error) {
	atomic.AddInt32(&l.getHits, 1)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.getErr != nil {
		return nil, l.getErr
	}
	if s, ok := l.setts[id]; ok {
		cp := *s
		return &cp, nil
	}
	return &settlement.Settlement{
		ID: id, Status: settlement.StatusEscrowed, FundingSource: "external",
		TotalKobo: 250_000, PayerID: "u1", IdempotencyKey: "fakeorder:" + key1,
	}, nil
}

// ── store ───────────────────────────────────────────────────────────────────

type fakeStore struct {
	mu       sync.Mutex
	byRef    map[string]*Intent
	putErr   error
	saveAuth int
	saveErr  error
	// saveFailFirstN fails the first N SaveAuthorization calls (transient blip).
	saveFailFirstN int
	// markErr, if set, makes Mark fail for transitions into that status.
	markErr map[string]error
	// now is injectable so stale-claim tests need no sleeping.
	now func() time.Time
	// beforeMark runs (without the lock) just before every Mark — lets a test
	// interleave a competing owner between an owner's read and its write.
	beforeMark func(ref string, t Transition)
	ev         *events

	// partial refund rows, keyed "<reference>|<refundKey>"
	partials map[string]*PartialRefund
	// partialMarkErr makes MarkPartialRefunded fail (store blip after the gateway refund).
	partialMarkErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{byRef: map[string]*Intent{}, now: time.Now, markErr: map[string]error{}, partials: map[string]*PartialRefund{}}
}

func (s *fakeStore) Put(_ context.Context, in Intent) (*Intent, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.putErr != nil {
		return nil, false, s.putErr
	}
	for _, e := range s.byRef {
		if e.Domain == in.Domain && e.IdempotencyKey == in.IdempotencyKey {
			cp := *e
			return &cp, false, nil
		}
	}
	cp := in
	cp.CreatedAt = s.now()
	s.byRef[in.Reference] = &cp
	return nil, true, nil
}

func (s *fakeStore) Get(_ context.Context, ref string) (*Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.byRef[ref]
	if !ok {
		return nil, ErrUnknownReference
	}
	cp := *e
	return &cp, nil
}

func (s *fakeStore) GetByEntity(_ context.Context, domain, id string) (*Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.byRef {
		if e.Domain == domain && e.EntityID != nil && *e.EntityID == id {
			cp := *e
			return &cp, nil
		}
	}
	return nil, ErrUnknownReference
}

func (s *fakeStore) SaveAuthorization(_ context.Context, ref, u, ac string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saveAuth++
	if s.saveErr != nil {
		return s.saveErr
	}
	if s.saveAuth <= s.saveFailFirstN {
		return errors.New("transient store failure")
	}
	if e, ok := s.byRef[ref]; ok && e.Status == StatusPending {
		e.AuthorizationURL, e.AccessCode = u, ac
	}
	return nil
}

func (s *fakeStore) Claim(_ context.Context, ref string, stale time.Duration) (Fence, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.byRef[ref]
	if !ok {
		return 0, false, nil
	}
	if e.Status == StatusPending || (e.Status == StatusProcessing && s.now().Sub(e.ClaimedAt) > stale) {
		e.Status = StatusProcessing
		e.ClaimedAt = s.now()
		e.ClaimGen++
		return e.ClaimGen, true, nil
	}
	return 0, false, nil
}

func (s *fakeStore) BeginRefund(_ context.Context, ref string, from []string, stale time.Duration) (*BeginRefundResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.byRef[ref]
	if !ok {
		return nil, false, nil
	}
	if e.RefundReservedKobo > 0 {
		return nil, false, nil // a whole-charge refund may never start on top of piece refunds
	}
	allowed := false
	for _, f := range from {
		if e.Status == f {
			allowed = true
		}
	}
	if e.Status == StatusRefunding && s.now().Sub(e.ClaimedAt) > stale {
		allowed = true
	}
	if !allowed {
		return nil, false, nil
	}
	prev := e.Status
	if prev != StatusRefunding || e.RefundFrom == "" {
		e.RefundFrom = prev
	}
	if e.RefundAmountKobo == 0 {
		e.RefundAmountKobo = e.AmountKobo
	}
	e.Status = StatusRefunding
	e.ClaimedAt = s.now()
	e.ClaimGen++
	return &BeginRefundResult{Fence: e.ClaimGen, Prev: prev, RefundFrom: e.RefundFrom, RefundAmountKobo: e.RefundAmountKobo}, true, nil
}

func (s *fakeStore) Mark(_ context.Context, ref string, t Transition) (bool, error) {
	if s.beforeMark != nil {
		s.beforeMark(ref, t)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.markErr[t.To]; err != nil {
		return false, err
	}
	e, ok := s.byRef[ref]
	if !ok {
		return false, errors.New("not found")
	}
	if e.Status != t.From || e.ClaimGen != t.Fence {
		return false, nil
	}
	e.Status = t.To
	if t.EntityID != nil {
		e.EntityID = t.EntityID
	}
	if t.RefundReference != nil {
		e.RefundReference = t.RefundReference
	}
	if t.To == StatusRefunding {
		e.RefundFrom, e.RefundAmountKobo = t.RefundFrom, t.RefundAmountKobo
		e.ClaimedAt = s.now()
	}
	s.ev.add("store.mark:" + t.From + ">" + t.To)
	return true, nil
}

func (s *fakeStore) ListForSweep(_ context.Context, statuses []string, olderThan, maxAge time.Duration, limit int) ([]Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Intent
	for _, e := range s.byRef {
		ok := false
		for _, st := range statuses {
			if e.Status == st {
				ok = true
			}
		}
		if !ok {
			continue
		}
		last := e.ClaimedAt
		if last.IsZero() {
			last = e.CreatedAt
		}
		if s.now().Sub(last) < olderThan {
			continue
		}
		if maxAge > 0 && s.now().Sub(e.CreatedAt) > maxAge {
			continue
		}
		out = append(out, *e)
	}
	return out, nil
}

// ── domain ──────────────────────────────────────────────────────────────────

type fakeDomain struct {
	quote        int64
	quotePricing json.RawMessage
	quoteErr     error

	bookErr   error
	findID    string
	findFound bool
	findErr   error
	// bookedID is what a successful Book returns; Book also records itself so
	// a later Find sees it (idempotent-booking semantics).
	bookedID string
	// bookHook runs inside Book (used to stall / assert the ctx deadline).
	bookHook func(ctx context.Context)

	ev         *events
	mu         sync.Mutex
	quotes     [][]byte
	books      int32
	bookAmts   []int64
	bookIdem   []string
	bookPrices []json.RawMessage
	bookCtxDL  []time.Time
	booked     bool
	findCalled int32
}

func (d *fakeDomain) Name() string            { return "fake" }
func (d *fakeDomain) ReferencePrefix() string { return "fakeorder:" }
func (d *fakeDomain) RoutePrefix() string     { return "/fakes/paystack" }
func (d *fakeDomain) EntityIDKey() string     { return "fakeId" }
func (d *fakeDomain) Quote(_ context.Context, _ string, raw json.RawMessage) (Quoted, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.quotes = append(d.quotes, raw)
	return Quoted{AmountKobo: d.quote, Pricing: d.quotePricing}, d.quoteErr
}
func (d *fakeDomain) Find(_ context.Context, _, _ string) (string, bool, error) {
	atomic.AddInt32(&d.findCalled, 1)
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.findErr != nil {
		return "", false, d.findErr
	}
	if d.booked {
		return d.bookedID, true, nil
	}
	return d.findID, d.findFound, nil
}
func (d *fakeDomain) Book(ctx context.Context, _ string, _ json.RawMessage, pricing json.RawMessage, idem string, amt int64) (string, error) {
	atomic.AddInt32(&d.books, 1)
	d.ev.add("domain.book")
	d.mu.Lock()
	id := d.bookedID // captured at entry: a hook (stall) may change it for the NEXT caller
	d.mu.Unlock()
	if d.bookHook != nil {
		d.bookHook(ctx)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.bookAmts = append(d.bookAmts, amt)
	d.bookIdem = append(d.bookIdem, idem)
	d.bookPrices = append(d.bookPrices, pricing)
	if dl, ok := ctx.Deadline(); ok {
		d.bookCtxDL = append(d.bookCtxDL, dl)
	}
	if d.bookErr != nil {
		return "", d.bookErr
	}
	d.booked = true
	return id, nil
}

// hasPrefix helper for event assertions.
func anyPrefix(list []string, p string) bool {
	for _, s := range list {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

// ── partial refund store (mirrors the SQL in PGStore) ───────────────────────

func pkey(ref, key string) string { return ref + "|" + key }

func (s *fakeStore) BeginPartialRefund(_ context.Context, ref, key, settID string, amt int64, stale time.Duration) (*PartialBegin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	in, ok := s.byRef[ref]
	if !ok {
		return nil, ErrUnknownReference
	}
	row := s.partials[pkey(ref, key)]
	if row != nil && row.Status == PartialRefunded {
		return &PartialBegin{AlreadyDone: true, Row: *row, ExpectedRefundedKobo: in.RefundedKobo, Now: s.now()}, nil
	}
	if in.Status != StatusConfirmed {
		return nil, ErrIntentNotRefundable
	}
	for _, o := range s.partials {
		if o.Reference == ref && o.RefundKey != key && o.Status == PartialRefunding {
			return nil, ErrPartialInFlight
		}
	}
	switch {
	case row == nil:
		if in.RefundReservedKobo+amt > in.AmountKobo {
			return nil, ErrPartialCapExceeded
		}
		in.RefundReservedKobo += amt
		row = &PartialRefund{Reference: ref, RefundKey: key, SettlementID: settID, AmountKobo: amt, Status: PartialRefunding, ClaimGen: 1, ClaimedAt: s.now(), Attempts: 1}
		s.partials[pkey(ref, key)] = row
		return &PartialBegin{Fence: row.ClaimGen, Prev: "", Row: *row, ExpectedRefundedKobo: in.RefundedKobo, Now: s.now()}, nil
	case row.AmountKobo != amt || row.SettlementID != settID:
		return nil, errors.New("partial refund row exists for a different amount/settlement")
	case row.Status == PartialRefunding:
		if s.now().Sub(row.ClaimedAt) <= stale {
			return nil, ErrPartialInFlight
		}
		row.ClaimGen++
		row.ClaimedAt = s.now()
		row.Attempts++
		return &PartialBegin{Fence: row.ClaimGen, Prev: PartialRefunding, Row: *row, ExpectedRefundedKobo: in.RefundedKobo, Now: s.now()}, nil
	default: // failed → reactivate
		if in.RefundReservedKobo+amt > in.AmountKobo {
			return nil, ErrPartialCapExceeded
		}
		in.RefundReservedKobo += amt
		row.Status = PartialRefunding
		row.ClaimGen++
		row.ClaimedAt = s.now()
		row.Attempts++
		return &PartialBegin{Fence: row.ClaimGen, Prev: PartialFailed, Row: *row, ExpectedRefundedKobo: in.RefundedKobo, Now: s.now()}, nil
	}
}

func (s *fakeStore) MarkPartialRefunded(_ context.Context, ref, key string, fence Fence, gwID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.partialMarkErr != nil {
		return false, s.partialMarkErr
	}
	row := s.partials[pkey(ref, key)]
	in := s.byRef[ref]
	if row == nil || in == nil || row.Status != PartialRefunding || row.ClaimGen != fence {
		return false, nil
	}
	row.Status = PartialRefunded
	if gwID != "" {
		row.GatewayRefundID = &gwID
	}
	in.RefundedKobo += row.AmountKobo
	if in.RefundedKobo == in.AmountKobo && in.Status == StatusConfirmed {
		in.Status = StatusRefunded
	}
	s.ev.add("store.partial:refunded")
	return true, nil
}

func (s *fakeStore) MarkPartialFailed(_ context.Context, ref, key string, fence Fence) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	row := s.partials[pkey(ref, key)]
	in := s.byRef[ref]
	if row == nil || in == nil || row.Status != PartialRefunding || row.ClaimGen != fence {
		return false, nil
	}
	row.Status = PartialFailed
	row.PostAttemptedAt = nil // a DEFINITE failure: an immediate retry may POST again
	in.RefundReservedKobo -= row.AmountKobo
	s.ev.add("store.partial:failed")
	return true, nil
}

func (s *fakeStore) GetPartial(_ context.Context, ref, key string) (*PartialRefund, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	row := s.partials[pkey(ref, key)]
	if row == nil {
		return nil, nil
	}
	cp := *row
	return &cp, nil
}

func (s *fakeStore) ListPartialsForSweep(_ context.Context, olderThan time.Duration, limit int) ([]PartialRefund, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []PartialRefund
	for _, r := range s.partials {
		if r.Status == PartialRefunding && s.now().Sub(r.ClaimedAt) >= olderThan {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (s *fakeStore) ListPartialsAwaitingLedger(_ context.Context, olderThan time.Duration, limit int) ([]PartialRefund, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []PartialRefund
	for _, r := range s.partials {
		if r.Status == PartialRefunded {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (s *fakeStore) MarkPartialPostAttempt(_ context.Context, ref, key string, fence Fence) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	row := s.partials[pkey(ref, key)]
	if row == nil || row.Status != PartialRefunding || row.ClaimGen != fence {
		return false, nil
	}
	now := s.now()
	row.PostAttemptedAt = &now
	s.ev.add("store.partial:post_attempt")
	return true, nil
}
