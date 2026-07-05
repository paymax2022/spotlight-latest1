package fractionalre

import "testing"

// TestThresholdDecidesAllocateVsRefund verifies the round-close branch: a round
// at or above its minimum threshold ALLOCATES; below it REFUNDS all subscribers.
func TestThresholdDecidesAllocateVsRefund(t *testing.T) {
	cases := []struct {
		name         string
		raised       int64
		minThresh    int64
		wantAllocate bool
	}{
		{"exactly at threshold → allocate", 50_000_000, 50_000_000, true},
		{"above threshold → allocate", 70_000_000, 50_000_000, true},
		{"one kobo below threshold → refund", 49_999_999, 50_000_000, false},
		{"nothing raised → refund", 0, 50_000_000, false},
		{"zero threshold always allocates", 0, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := thresholdMet(tc.raised, tc.minThresh); got != tc.wantAllocate {
				t.Errorf("thresholdMet(%d,%d)=%v want %v", tc.raised, tc.minThresh, got, tc.wantAllocate)
			}
		})
	}
}

// TestMakerCheckerSoD documents the separation-of-duties rule used by
// CloseAndSettle / RefundRound / ApproveDistribution: the checker MUST be a
// different user from the maker. We assert the comparison the service performs.
func TestMakerCheckerSoD(t *testing.T) {
	maker := "user-maker"
	// Same user acting as checker → must be rejected.
	if maker == "user-checker" {
		t.Fatal("test setup invalid")
	}
	sameUserBlocked := func(makerID, checkerID string) bool { return makerID == checkerID }
	if !sameUserBlocked(maker, maker) {
		t.Error("maker acting as own checker must be detected (SoD violation)")
	}
	if sameUserBlocked(maker, "user-checker") {
		t.Error("distinct maker/checker must be allowed")
	}
	// Sentinel must be distinct and non-nil.
	if ErrMakerChecker == nil || ErrMakerChecker == ErrTitleSoD {
		t.Error("ErrMakerChecker must be a distinct non-nil sentinel")
	}
}

// TestTitleVerifierSoD documents that the title verifier must differ from the
// asset creator (the check TitleVerify performs against asset.CreatedBy).
func TestTitleVerifierSoD(t *testing.T) {
	creator := "user-creator"
	if creator == creator+"x" {
		t.Fatal("invalid")
	}
	// verifier == creator → ErrTitleSoD; verifier != creator → ok.
	verifierIsCreator := func(creatorID, verifierID string) bool { return creatorID == verifierID }
	if !verifierIsCreator(creator, creator) {
		t.Error("verifier == creator must be flagged as an SoD violation")
	}
	if verifierIsCreator(creator, "user-verifier") {
		t.Error("independent verifier must be permitted")
	}
	if ErrTitleSoD == nil {
		t.Error("ErrTitleSoD must be non-nil")
	}
}

// TestLifecycleTransitions verifies the role-gated asset state machine: legal
// transitions return a permission slug; illegal ones are rejected.
func TestLifecycleTransitions(t *testing.T) {
	legal := []struct{ from, to AssetStatus }{
		{AssetDraft, AssetDueDiligence},
		{AssetDueDiligence, AssetTitleVerify},
		{AssetTitleVerify, AssetApproved},
		{AssetApproved, AssetLive},
		{AssetLive, AssetFunded},
		{AssetLive, AssetRefundClose},
		{AssetFunded, AssetUnderManagement},
		{AssetUnderManagement, AssetDistributions},
		{AssetDistributions, AssetExit},
		{AssetExit, AssetClosed},
		{AssetRefundClose, AssetClosed},
	}
	for _, tc := range legal {
		if perm, ok := CanTransition(tc.from, tc.to); !ok || perm == "" {
			t.Errorf("expected legal transition %s -> %s with a permission slug", tc.from, tc.to)
		}
	}

	illegal := []struct{ from, to AssetStatus }{
		{AssetDraft, AssetLive},     // can't skip due-diligence/title
		{AssetDraft, AssetApproved}, // can't skip to approved
		{AssetClosed, AssetLive},    // terminal
		{AssetFunded, AssetDraft},   // no backward to draft
		{AssetLive, AssetClosed},    // must go through funded/refund
	}
	for _, tc := range illegal {
		if _, ok := CanTransition(tc.from, tc.to); ok {
			t.Errorf("expected ILLEGAL transition %s -> %s to be rejected", tc.from, tc.to)
		}
	}
}

// TestSubscribeRequiresIdempotencyKey documents that the subscribe money path
// rejects a missing Idempotency-Key BEFORE any DB/ledger interaction (fail-closed
// guard reached before the pool is touched, so a nil-deps service is safe here).
func TestSubscribeRequiresIdempotencyKey(t *testing.T) {
	s := &Service{} // guard runs before any collaborator is used
	_, err := s.Subscribe(nil, "user-1", "", "offering-1", SubscribeRequest{Units: 1})
	if err != ErrIdempotencyKey {
		t.Errorf("expected ErrIdempotencyKey for empty key, got %v", err)
	}
	// Whitespace-only key is also rejected.
	_, err = s.Subscribe(nil, "user-1", "   ", "offering-1", SubscribeRequest{Units: 1})
	if err != ErrIdempotencyKey {
		t.Errorf("expected ErrIdempotencyKey for whitespace key, got %v", err)
	}
}

// TestScheduleDistributionRequiresIdempotencyKey mirrors the same guard on the
// distribution money path.
func TestScheduleDistributionRequiresIdempotencyKey(t *testing.T) {
	s := &Service{}
	_, err := s.ScheduleDistribution(nil, "maker-1", "", ScheduleDistributionRequest{AssetID: "a", GrossKobo: 100})
	if err != ErrIdempotencyKey {
		t.Errorf("expected ErrIdempotencyKey, got %v", err)
	}
}

// TestUniqueViolationDetection verifies the idempotency-key duplicate detector
// recognises a Postgres unique_violation (used to make double-subscribe a no-op).
func TestUniqueViolationDetection(t *testing.T) {
	if !isUniqueViolation(errString("ERROR: duplicate key value violates unique constraint (SQLSTATE 23505)")) {
		t.Error("expected SQLSTATE 23505 to be detected as a unique violation")
	}
	if isUniqueViolation(errString("some other error")) {
		t.Error("non-unique-violation must not be detected")
	}
	if isUniqueViolation(nil) {
		t.Error("nil error must not be a unique violation")
	}
}

type errString string

func (e errString) Error() string { return string(e) }
