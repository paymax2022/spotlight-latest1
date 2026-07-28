package arena

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"

	"spotlight/backend/internal/platform/crypto"
)

func newSigner(t *testing.T, id string) *crypto.Signer {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	rand.Read(seed)
	s, err := crypto.NewSignerFromSeed(id, base64.StdEncoding.EncodeToString(seed))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLifecycle_Guards(t *testing.T) {
	if !CanTransition(StApplied, StScreened) || !CanTransition(StTheoryTaken, StQualified) || !CanTransition(StFinalist, StCrowned) {
		t.Fatal("legal transitions must be allowed")
	}
	// Illegal jumps blocked.
	if CanTransition(StApplied, StCrowned) {
		t.Fatal("cannot jump APPLIED → CROWNED")
	}
	if CanTransition(StCrowned, StEliminated) {
		t.Fatal("CROWNED is terminal")
	}
	// Admin withdraw path from a non-terminal state.
	if !CanTransition(StTrained, StWithdrawn) {
		t.Fatal("admin WITHDRAWN path must exist from non-terminal states")
	}
}

func TestAdvancement_ReadsMeritOnly(t *testing.T) {
	for _, to := range []ContestantState{StQualified, StFinalist, StCrowned} {
		if !AdvancementReadsMeritOnly(to) {
			t.Fatalf("%s must be merit-only", to)
		}
	}
	if AdvancementReadsMeritOnly(StTrained) {
		t.Fatal("TRAINED is not a merit-gated advancement")
	}
}

func TestMeritFirewall_SignAndVerify(t *testing.T) {
	signer := newSigner(t, "theory-exam")
	ver := crypto.NewVerifier()
	_ = ver.Register(signer.ID(), signer.PublicKeyB64())

	p := ScorePayload{
		CompetitionID: "comp1", ContestantID: "c1", SourceType: SourceTheoryExam,
		AdapterID: "theory-exam", Stage: StageTheoryB1, RubricVersion: "theory-2026-v1",
		RawScore: 45, NormalizedScore: 90, SignedAt: time.Now().UTC(),
	}
	entry := SignScore(signer, p, nil)
	if !VerifyMeritEntry(ver, entry) {
		t.Fatal("a properly signed entry must verify")
	}
	// Tamper the normalized score after signing → verification fails.
	bad := entry
	bad.Canonical = ScorePayload{CompetitionID: "comp1", NormalizedScore: 100}.Canonical()
	if VerifyMeritEntry(ver, bad) {
		t.Fatal("tampered canonical must not verify")
	}
	// An unauthorized adapter id cannot produce a verifiable entry.
	rogue := newSigner(t, "rogue")
	rp := p
	rp.AdapterID = "rogue"
	rentry := SignScore(rogue, rp, nil)
	if VerifyMeritEntry(ver, rentry) {
		t.Fatal("unregistered adapter must be rejected (NDC-2)")
	}
	// Zero-value entry is not appendable.
	if VerifyMeritEntry(ver, SignedMeritEntry{}) {
		t.Fatal("zero entry must not verify")
	}
}

func TestMeritChain_LinksEntries(t *testing.T) {
	signer := newSigner(t, "practical-judge")
	ver := crypto.NewVerifier()
	_ = ver.Register(signer.ID(), signer.PublicKeyB64())
	p1 := ScorePayload{CompetitionID: "c", ContestantID: "x", SourceType: SourcePractical, AdapterID: "practical-judge", Stage: StageFinalePractical, RubricVersion: "v1", RawScore: 1, NormalizedScore: 80, SignedAt: time.Now().UTC()}
	e1 := SignScore(signer, p1, nil)
	p2 := p1
	p2.SignedAt = p1.SignedAt.Add(time.Minute)
	p2.NormalizedScore = 85
	e2 := SignScore(signer, p2, e1.EntryHash)
	if !VerifyMeritEntry(ver, e1) || !VerifyMeritEntry(ver, e2) {
		t.Fatal("chained entries must verify")
	}
	if string(e2.PrevHash) != string(e1.EntryHash) {
		t.Fatal("e2 must chain to e1")
	}
}

func TestRailFirewall_Policy(t *testing.T) {
	if !WritesMerit(RailMerit) {
		t.Fatal("MERIT rail must target the merit ledger")
	}
	for _, r := range []Rail{RailSupport, RailPlayAlong, RailSponsor} {
		if WritesMerit(r) {
			t.Fatalf("%s must NOT write merit (NDC-1)", r)
		}
	}
	if !AwardFedByMeritOnly(AwardNaijaDriverCrown) {
		t.Fatal("the crown must be fed by Merit only")
	}
	if AwardFedByMeritOnly(AwardPeoplesChampion) {
		t.Fatal("People's Champion is a Support-fed award, not merit")
	}
}
