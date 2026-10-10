package social

// LIVE-DB tests for the wave-12 admin-oversight residual + the non-party
// mutation oracle sweep.
//
// Residual: PR #602 made Service.GetSplit caller-scoped (uniform 404) but the
// admin route /api/social/admin/splits/:id kept pointing at it — an ops admin
// holding social.admin.view who was not a participant got 404 and lost
// oversight. Dedicated oversight reads (GetSplitOversight / GetPoolOversight,
// RBAC-gated at the route) restore it WITHOUT reopening the member oracle.
//
// Sweep (same class as the GetSplit oracle): request and share/pool
// MUTATIONS refused a non-party with ErrForbidden vs ErrNotFound on a
// nonexistent id — confirming the object exists. Non-parties now get the
// uniform ErrNotFound; parties in the wrong role keep the precise 403.
//
// ⚠️ GATED ON TEST_DATABASE_URL — these seed users, handles and money. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/social/ -run 'TestLiveDB_' -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// An ops admin is just another user id to the service — the RBAC guard at the
// route is the gate. The oversight read must return the bill + full share
// roster for a split the caller does NOT participate in, while the member
// read stays uniform-404 for the very same caller.
func TestLiveDB_SocialAdminSplitOversight_NonParticipantReads(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	rec := &recordingAuditor{}
	svc := socialServiceWithAudit(pool, rec)

	organiser := socialTestUser(t, pool)
	participant := socialTestUser(t, pool)
	admin := socialTestUser(t, pool) // ops identity — NOT a participant

	orgHandle := "oz" + shortTag()
	if _, err := svc.tags.Claim(ctx, organiser, orgHandle); err != nil {
		t.Fatalf("claim organiser handle: %v", err)
	}
	pHandle := "pz" + shortTag()
	if _, err := svc.tags.Claim(ctx, participant, pHandle); err != nil {
		t.Fatalf("claim participant handle: %v", err)
	}
	bill, _, err := svc.CreateSplit(ctx, organiser, "oversight-split", 500_00, SplitEqual,
		[]ShareInput{{Handle: orgHandle}, {Handle: pHandle}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}

	// Oversight read: bill + the full share roster — who owes whom how much.
	got, shares, err := svc.GetSplitOversight(ctx, admin, bill.ID)
	if err != nil {
		t.Fatalf("admin GetSplitOversight err = %v, want nil", err)
	}
	if got.ID != bill.ID || got.TotalKobo != 500_00 {
		t.Fatalf("oversight bill = %+v, want %s totalling 50000", got, bill.ID)
	}
	if len(shares) != 2 {
		t.Fatalf("oversight shares = %d, want 2 (the full roster)", len(shares))
	}
	var sum int64
	for _, sh := range shares {
		sum += sh.AmountKobo
	}
	if sum != bill.TotalKobo {
		t.Fatalf("share roster sums to %d, want %d (conservation)", sum, bill.TotalKobo)
	}

	// The member oracle stays CLOSED for the same caller id.
	if _, _, err := svc.GetSplit(ctx, admin, bill.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member GetSplit for non-participant err = %v, want ErrNotFound (oracle must stay closed)", err)
	}
	// Nonexistent id → ErrNotFound either way.
	if _, _, err := svc.GetSplitOversight(ctx, admin, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id GetSplitOversight err = %v, want ErrNotFound", err)
	}

	// The oversight access is audited.
	var audited bool
	for _, a := range rec.actions {
		if a == "social.admin.split.view" {
			audited = true
		}
	}
	if !audited {
		t.Errorf("oversight read emitted no audit event; got %v", rec.actions)
	}
}

// Same residual on the pool rail: member pool reads are caller-scoped, so an
// admin with no stake needs the dedicated oversight read — pool + derived
// balance + contribution roster.
func TestLiveDB_SocialAdminPoolOversight_NonStakeholderReads(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	rec := &recordingAuditor{}
	svc := socialServiceWithAudit(pool, rec)
	led := ledger.NewService(ledger.NewRepository(pool), nil)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)
	admin := socialTestUser(t, pool) // ops identity — NO stake in the pool

	p, err := svc.CreatePool(ctx, organiser, "oversight-pool", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	if _, err := svc.ContributePool(ctx, contributor, p.ID, 400_00, "c-"+shortTag()); err != nil {
		t.Fatalf("contribute: %v", err)
	}

	got, bal, contribs, err := svc.GetPoolOversight(ctx, admin, p.ID)
	if err != nil {
		t.Fatalf("admin GetPoolOversight err = %v, want nil", err)
	}
	if got.ID != p.ID || bal != 400_00 {
		t.Fatalf("oversight pool=%+v balance=%d, want pool %s at 40000", got, bal, p.ID)
	}
	if len(contribs) != 1 || contribs[0].UserID != contributor || contribs[0].AmountKobo != 400_00 {
		t.Fatalf("contribution roster = %+v, want the single 40000 contribution by %s", contribs, contributor)
	}

	// Member reads stay uniform-404 for the same caller id.
	if _, err := svc.PoolBalance(ctx, admin, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member PoolBalance for non-stakeholder err = %v, want ErrNotFound", err)
	}
	if _, err := svc.GetPool(ctx, admin, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member GetPool for non-stakeholder err = %v, want ErrNotFound", err)
	}
	if _, _, _, err := svc.GetPoolOversight(ctx, admin, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id GetPoolOversight err = %v, want ErrNotFound", err)
	}

	var audited bool
	for _, a := range rec.actions {
		if a == "social.admin.pool.view" {
			audited = true
		}
	}
	if !audited {
		t.Errorf("oversight read emitted no audit event; got %v", rec.actions)
	}
}

// Request mutations: pay/decline/cancel by a NON-PARTY must answer the same
// ErrNotFound a nonexistent request id returns — a 403 confirms the request
// exists (oracle). Parties in the wrong role keep the precise 403: they can
// already see the request via ListRequests, so nothing new is confirmed.
func TestLiveDB_SocialRequestMutations_NonParty_NotFound(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	outsider := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "rq" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim payer handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "owed", 500_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}

	// Non-party: uniform ErrNotFound on pay/decline/cancel, identical to a
	// request id that does not exist.
	if err := svc.PayRequest(ctx, outsider, req.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider PayRequest err = %v, want ErrNotFound", err)
	}
	if err := svc.DeclineRequest(ctx, outsider, req.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider DeclineRequest err = %v, want ErrNotFound", err)
	}
	if err := svc.CancelRequest(ctx, outsider, req.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider CancelRequest err = %v, want ErrNotFound", err)
	}
	if err := svc.PayRequest(ctx, outsider, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id PayRequest err = %v, want ErrNotFound (indistinguishable)", err)
	}

	// Parties in the wrong role keep 403 — they already know it exists.
	if err := svc.PayRequest(ctx, requester, req.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("requester PayRequest err = %v, want ErrForbidden (party, wrong role)", err)
	}
	if err := svc.CancelRequest(ctx, payer, req.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("payer CancelRequest err = %v, want ErrForbidden (party, wrong role)", err)
	}
	if err := svc.DeclineRequest(ctx, requester, req.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("requester DeclineRequest err = %v, want ErrForbidden (party, wrong role)", err)
	}

	// The refusals touched nothing: still PENDING and payable.
	got, err := svc.getRequest(ctx, req.ID)
	if err != nil || got.State != RequestPending {
		t.Fatalf("request state = %v err=%v after refusals, want PENDING", got, err)
	}
}

// PayShare: a caller who owns no share on the bill and has no stake in it
// must get the uniform ErrNotFound; a participant (incl. the organiser) who
// tries to pay someone else's share keeps the precise 403.
func TestLiveDB_SocialPayShare_NonParticipant_NotFound(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	payerA := socialTestUser(t, pool)
	payerB := socialTestUser(t, pool)
	outsider := socialTestUser(t, pool)

	handleA := "sa" + shortTag()
	if _, err := svc.tags.Claim(ctx, payerA, handleA); err != nil {
		t.Fatalf("claim handle A: %v", err)
	}
	handleB := "sb" + shortTag()
	if _, err := svc.tags.Claim(ctx, payerB, handleB); err != nil {
		t.Fatalf("claim handle B: %v", err)
	}
	_, shares, err := svc.CreateSplit(ctx, organiser, "oracle-share", 800_00, SplitEqual,
		[]ShareInput{{Handle: handleA}, {Handle: handleB}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	var shareA string
	for _, sh := range shares {
		if sh.UserID == payerA {
			shareA = sh.ID
		}
	}
	if shareA == "" {
		t.Fatalf("payer A share not found in %+v", shares)
	}

	// Outsider: uniform ErrNotFound — identical to a share id that does not
	// exist, so the route confirms nothing.
	if err := svc.PayShare(ctx, outsider, shareA, "k-"+shortTag()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider PayShare err = %v, want ErrNotFound", err)
	}
	if err := svc.PayShare(ctx, outsider, uuid.NewString(), "k-"+shortTag()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id PayShare err = %v, want ErrNotFound (indistinguishable)", err)
	}

	// Participants in the wrong role keep 403 (they can already see the
	// share roster via GetSplit).
	if err := svc.PayShare(ctx, organiser, shareA, "k-"+shortTag()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("organiser PayShare err = %v, want ErrForbidden (participant, not owner)", err)
	}
	if err := svc.PayShare(ctx, payerB, shareA, "k-"+shortTag()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("sibling participant PayShare err = %v, want ErrForbidden", err)
	}
}

// PayoutPool: a caller with no stake in the pool gets the uniform
// ErrNotFound (the old getPool+403 confirmed the pool exists); a stakeholder
// who is not the organiser keeps 403; the organiser still pays out.
func TestLiveDB_SocialPayoutPool_NonStakeholder_NotFound(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)
	outsider := socialTestUser(t, pool)

	p, err := svc.CreatePool(ctx, organiser, "oracle-payout", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	if _, err := svc.ContributePool(ctx, contributor, p.ID, 250_00, "c-"+shortTag()); err != nil {
		t.Fatalf("contribute: %v", err)
	}

	if err := svc.PayoutPool(ctx, outsider, p.ID, "k-"+shortTag()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider PayoutPool err = %v, want ErrNotFound", err)
	}
	if err := svc.PayoutPool(ctx, outsider, uuid.NewString(), "k-"+shortTag()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("random-id PayoutPool err = %v, want ErrNotFound (indistinguishable)", err)
	}
	if err := svc.PayoutPool(ctx, contributor, p.ID, "k-"+shortTag()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("contributor PayoutPool err = %v, want ErrForbidden (stakeholder, not organiser)", err)
	}

	// The refusals touched nothing: still OPEN, balance intact, organiser
	// pays out cleanly.
	if err := svc.PayoutPool(ctx, organiser, p.ID, "pay-"+shortTag()); err != nil {
		t.Fatalf("organiser payout err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 250_00 {
		t.Fatalf("organiser balance = %d, want 25000", bal)
	}
}
