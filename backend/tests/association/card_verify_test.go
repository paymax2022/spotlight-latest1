package association_test

// Membership-card QR signing + verification (MC-003/004/005, EC-007). Live-DB.
// Proves: a genuine card verifies; a tampered/forged/old-plaintext token is
// rejected; and a genuine signature still FAILS when the live record is
// suspended, expired, in arrears, or missing (authenticity != validity).

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

func TestLiveDB_Card_ValidCardVerifies(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "CardOrg "+uuid.New().String())
	userID, _ := seedActiveMembership(t, ctx, pool, org)

	card, err := svc.GetCard(ctx, userID)
	if err != nil {
		t.Fatalf("GetCard: %v", err)
	}
	if card.QRPayload == "" || card.QRPayload[:5] != "AMC1." {
		t.Fatalf("QR payload is not a signed token: %q", card.QRPayload)
	}
	res, err := svc.VerifyCard(ctx, card.QRPayload)
	if err != nil {
		t.Fatalf("VerifyCard: %v", err)
	}
	if !res.Valid {
		t.Fatalf("genuine active card must verify valid, got reason=%q", res.Reason)
	}
	if res.MemberID != card.MemberID || res.Status != "ACTIVE" {
		t.Errorf("verification member mismatch: got id=%s status=%s", res.MemberID, res.Status)
	}
}

func TestLiveDB_Card_TamperedAndForgedRejected(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "TamperOrg "+uuid.New().String())
	userID, _ := seedActiveMembership(t, ctx, pool, org)
	card, err := svc.GetCard(ctx, userID)
	if err != nil {
		t.Fatalf("GetCard: %v", err)
	}
	tok := card.QRPayload

	// Flip the final character of the signature.
	tampered := tok[:len(tok)-1] + flip(tok[len(tok)-1])
	cases := map[string]string{
		"tampered-signature": tampered,
		"forged-garbage":     "AMC1.YWJj.ZGVm",
		"old-plaintext":      "assoc:NMA/LA/2024/0192",
		"empty":              "",
		"wrong-version":      "AMC9." + tok[5:],
	}
	for name, bad := range cases {
		res, err := svc.VerifyCard(ctx, bad)
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", name, err)
		}
		if res.Valid {
			t.Errorf("%s: forged/tampered token verified as VALID", name)
		}
		if res.Reason != "INVALID_SIGNATURE" {
			t.Errorf("%s: reason = %q, want INVALID_SIGNATURE", name, res.Reason)
		}
	}
}

func TestLiveDB_Card_SuspendedExpiredArrearsFailLiveCheck(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "LiveOrg "+uuid.New().String())

	// Each sub-case: a genuinely-signed token whose live record is not in good standing.
	t.Run("suspended", func(t *testing.T) {
		_, mid := seedActiveMembership(t, ctx, pool, org)
		mustExec(t, ctx, pool, `UPDATE assoc_memberships SET status='SUSPENDED' WHERE id=$1`, mid)
		res := verifySigned(t, ctx, svc, mid)
		assertInvalid(t, res, "SUSPENDED")
	})
	t.Run("expired-by-date", func(t *testing.T) {
		_, mid := seedActiveMembership(t, ctx, pool, org)
		mustExec(t, ctx, pool, `UPDATE assoc_memberships SET valid_through = now() - interval '1 day' WHERE id=$1`, mid)
		res := verifySigned(t, ctx, svc, mid)
		assertInvalid(t, res, "EXPIRED")
	})
	t.Run("arrears", func(t *testing.T) {
		_, mid := seedActiveMembership(t, ctx, pool, org)
		mustExec(t, ctx, pool, `UPDATE assoc_memberships SET payment_standing='OVERDUE' WHERE id=$1`, mid)
		res := verifySigned(t, ctx, svc, mid)
		assertInvalid(t, res, "ARREARS")
	})
	t.Run("not-found", func(t *testing.T) {
		// Genuine signature over a membership id that does not exist.
		tok := svc.SignCardToken(uuid.New().String(), "GHOST/0001", org)
		res, err := svc.VerifyCard(ctx, tok)
		if err != nil {
			t.Fatalf("VerifyCard: %v", err)
		}
		assertInvalid(t, res, "NOT_FOUND")
	})
}

// ── helpers ────────────────────────────────────────────────────────────────

func verifySigned(t *testing.T, ctx context.Context, svc *association.Service, membershipID string) *association.CardVerification {
	t.Helper()
	tok := svc.SignCardToken(membershipID, "CODE/0001", "org")
	res, err := svc.VerifyCard(ctx, tok)
	if err != nil {
		t.Fatalf("VerifyCard: %v", err)
	}
	return res
}

func assertInvalid(t *testing.T, res *association.CardVerification, wantReason string) {
	t.Helper()
	if res.Valid {
		t.Fatalf("expected invalid card (reason %s), got valid", wantReason)
	}
	if res.Reason != wantReason {
		t.Errorf("reason = %q, want %q", res.Reason, wantReason)
	}
}

func mustExec(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func flip(b byte) string {
	if b == 'A' {
		return "B"
	}
	return "A"
}
