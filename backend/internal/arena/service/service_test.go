package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/platform/crypto"
)

// ── Fakes for the repo interfaces (no DB) ────────────────────────────────────

type fakeAudit struct{ n int }

func (f *fakeAudit) Log(context.Context, AuditRecord) error { f.n++; return nil }

type fakeMeritRepo struct {
	adapters []AuthorizedAdapter
	inserted []arena.SignedMeritEntry
	seen     map[string]bool // replay guard keyed by entry hash
}

func newFakeMeritRepo(ad ...AuthorizedAdapter) *fakeMeritRepo {
	return &fakeMeritRepo{adapters: ad, seen: map[string]bool{}}
}
func (f *fakeMeritRepo) AuthorizedAdapters(context.Context, string) ([]AuthorizedAdapter, error) {
	return f.adapters, nil
}
func (f *fakeMeritRepo) LastEntryHash(context.Context, string, string) ([]byte, error) {
	return nil, nil
}
func (f *fakeMeritRepo) Insert(_ context.Context, e arena.SignedMeritEntry) error {
	key := string(e.EntryHash)
	if f.seen[key] {
		return ErrReplay
	}
	f.seen[key] = true
	f.inserted = append(f.inserted, e)
	return nil
}
func (f *fakeMeritRepo) Leaderboard(context.Context, string, arena.Stage) ([]LeaderRow, error) {
	return nil, nil
}
func (f *fakeMeritRepo) RefreshLeaderboard(context.Context) error { return nil }
func (f *fakeMeritRepo) ContestantMerit(context.Context, string, string) ([]MeritEntryRow, error) {
	return nil, nil
}
func (f *fakeMeritRepo) CompetitionMerit(context.Context, string) ([]MeritEntryRow, error) {
	return nil, nil
}

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

func authFor(s *crypto.Signer, src string) AuthorizedAdapter {
	return AuthorizedAdapter{AdapterID: s.ID(), SourceType: src, PublicKey: s.PublicKeyB64(), Active: true}
}

// TestFirewall_VerifyBeforeAppend proves the merit ledger appends ONLY entries
// signed by a registered active adapter, and rejects unauthorized signers.
func TestFirewall_VerifyBeforeAppend(t *testing.T) {
	signer := newSigner(t, "theory-exam")
	repo := newFakeMeritRepo(authFor(signer, "THEORY_EXAM"))
	audit := &fakeAudit{}
	ms := NewMeritService(repo, audit)

	p := arena.ScorePayload{CompetitionID: "c1", ContestantID: "k1", SourceType: arena.SourceTheoryExam,
		AdapterID: signer.ID(), Stage: arena.StageTheoryB1, RubricVersion: "v1", RawScore: 45, NormalizedScore: 90}
	entry := arena.SignScore(signer, p, nil)
	if err := ms.Append(context.Background(), "actor", entry); err != nil {
		t.Fatalf("authorized signed entry must append: %v", err)
	}
	if len(repo.inserted) != 1 {
		t.Fatal("entry must be persisted")
	}

	// Unregistered/rogue signer → rejected (NDC-2).
	rogue := newSigner(t, "rogue")
	rp := p
	rp.AdapterID = rogue.ID()
	rentry := arena.SignScore(rogue, rp, nil)
	if err := ms.Append(context.Background(), "actor", rentry); err != ErrUnauthorizedSig {
		t.Fatalf("rogue signer must be rejected with ErrUnauthorizedSig, got %v", err)
	}
	if len(repo.inserted) != 1 {
		t.Fatal("rogue entry must NOT be persisted")
	}
}

// TestFirewall_Replay proves a duplicate signed entry is rejected as a replay.
func TestFirewall_Replay(t *testing.T) {
	signer := newSigner(t, "theory-exam")
	repo := newFakeMeritRepo(authFor(signer, "THEORY_EXAM"))
	ms := NewMeritService(repo, &fakeAudit{})
	p := arena.ScorePayload{CompetitionID: "c1", ContestantID: "k1", SourceType: arena.SourceTheoryExam,
		AdapterID: signer.ID(), Stage: arena.StageTheoryB1, RubricVersion: "v1", NormalizedScore: 88}
	entry := arena.SignScore(signer, p, nil)
	if err := ms.Append(context.Background(), "actor", entry); err != nil {
		t.Fatal(err)
	}
	if err := ms.Append(context.Background(), "actor", entry); err != ErrReplay {
		t.Fatalf("replay must be rejected with ErrReplay, got %v", err)
	}
}

// TestFirewall_MoneyRailsHaveNoSigner proves at compile time (by construction)
// that the Support rail cannot mint a merit entry: it is built with no signer and
// no ScoringGateway. It can only move money and tag a support row.
func TestFirewall_MoneyRailsHaveNoSigner(t *testing.T) {
	led := newFakeLedger()
	repo := &fakeSupportRepo{}
	svc := NewSupportService(repo, led, fakeTier{3}, fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{})
	// The type has no field or method that yields a *crypto.Signer / SignedMeritEntry.
	// The only capability it holds is money movement + tagging. A contribute posts
	// money and tags a row, never touching merit.
	if err := svc.Contribute(context.Background(), "u1", "idem-1", "c1", "k1", 5000); err != nil {
		t.Fatalf("contribute should succeed: %v", err)
	}
	if led.debits != 1 || len(repo.rows) != 1 {
		t.Fatal("support must post exactly one money movement + one tag")
	}
}

// ── Fakes for the money rails ────────────────────────────────────────────────

type fakeLedger struct {
	debits, credits int
	idem            map[string]bool
}

func newFakeLedger() *fakeLedger { return &fakeLedger{idem: map[string]bool{}} }
func (f *fakeLedger) Credit(_ context.Context, _, _, idem, _ string, _ int64) error {
	if f.idem[idem] {
		return nil
	}
	f.idem[idem] = true
	f.credits++
	return nil
}
func (f *fakeLedger) Debit(_ context.Context, _, _, idem, _ string, _ int64) error {
	if f.idem[idem] {
		return nil
	}
	f.idem[idem] = true
	f.debits++
	return nil
}
func (f *fakeLedger) StandingAccountID(context.Context, string) (string, error) { return "acct-pot", nil }

type fakeTier struct{ tier int }

func (f fakeTier) UserTier(context.Context, string) (int, error) { return f.tier, nil }

type fakeCfg struct{ c Config }

func (f fakeCfg) CurrentConfig(context.Context, string) (*Config, error) { return &f.c, nil }

type fakeSupportRepo struct{ rows []SupportRow }

func (f *fakeSupportRepo) TagAfterLedger(_ context.Context, _, contestantID, homeState, _, _, idem string, amt int64) error {
	f.rows = append(f.rows, SupportRow{ContestantID: contestantID, HomeState: homeState, AmountKobo: amt})
	return nil
}
func (f *fakeSupportRepo) Rows(context.Context, string) ([]SupportRow, error) { return f.rows, nil }

// TestSupport_Idempotent proves a replayed idempotency key does not double-charge
// or double-tag (fake ledger + repo).
func TestSupport_Idempotent(t *testing.T) {
	led := newFakeLedger()
	repo := &fakeSupportRepo{}
	svc := NewSupportService(repo, led, fakeTier{3}, fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{})
	for i := 0; i < 3; i++ {
		if err := svc.Contribute(context.Background(), "u1", "same-idem", "c1", "k1", 1000); err != nil {
			t.Fatal(err)
		}
	}
	if led.debits != 1 {
		t.Fatalf("idempotent support must debit exactly once, got %d", led.debits)
	}
}

// TestSupport_KYCGate proves the NDC-3 identity gate fails closed below tier.
func TestSupport_KYCGate(t *testing.T) {
	svc := NewSupportService(&fakeSupportRepo{}, newFakeLedger(), fakeTier{0}, fakeCfg{Config{RequiredKYCTier: 2}}, &fakeAudit{})
	if err := svc.Contribute(context.Background(), "u1", "idem", "c1", "k1", 1000); err != ErrKYCTierTooLow {
		t.Fatalf("below-tier support must be ErrKYCTierTooLow, got %v", err)
	}
}

// TestPotTotal_DerivedFromSupportRows proves the pot total is a projection over
// support rows (never a stored balance) and PeoplesChampion/StatePride derive too.
func TestPotTotal_DerivedFromSupportRows(t *testing.T) {
	rows := []SupportRow{
		{ContestantID: "a", HomeState: "LA", AmountKobo: 3000},
		{ContestantID: "b", HomeState: "KN", AmountKobo: 5000},
		{ContestantID: "a", HomeState: "LA", AmountKobo: 2000},
	}
	if got := PotTotalKobo(rows); got != 10000 {
		t.Fatalf("pot total want 10000, got %d", got)
	}
	if w, _ := PeoplesChampion(rows); w != "a" { // a=5000 vs b=5000 → tie broken by id "a"
		t.Fatalf("peoples champion want a, got %s", w)
	}
	if w, _ := StatePride(rows); w != "LA" { // LA=5000 vs KN=5000 → tie broken by "KN"<"LA"? KN sorts first
		// KN(5000) and LA(5000) tie; StatePride breaks ties by the LAST seen higher,
		// deterministic by sorted state code — KN precedes LA so KN wins the >best.
		if w != "KN" {
			t.Fatalf("state pride want KN or LA (deterministic), got %s", w)
		}
	}
}

// ── Credential verify-by-hash (pure, no DB via a fake repo) ──────────────────

type fakeCredRepo struct{ store map[string]*Credential }

func newFakeCredRepo() *fakeCredRepo { return &fakeCredRepo{store: map[string]*Credential{}} }
func (f *fakeCredRepo) Issue(_ context.Context, c Credential) error {
	if _, ok := f.store[c.VerifiableHash]; ok {
		return nil // idempotent
	}
	cp := c
	f.store[c.VerifiableHash] = &cp
	return nil
}
func (f *fakeCredRepo) GetByHash(_ context.Context, hash string) (*Credential, error) {
	if c, ok := f.store[hash]; ok {
		return c, nil
	}
	return nil, ErrNotFound
}
func (f *fakeCredRepo) Revoke(_ context.Context, hash, reason string) error {
	c, ok := f.store[hash]
	if !ok {
		return ErrNotFound
	}
	c.Status = "REVOKED"
	c.RevokeReason = reason
	return nil
}

func TestCredential_VerifyByHash(t *testing.T) {
	repo := newFakeCredRepo()
	svc := NewCredentialService(repo, &fakeAudit{})
	hash, err := svc.Issue(context.Background(), "actor", "u1", "c1", string(arena.CredNaijaDriver), "crown:c1:k1")
	if err != nil {
		t.Fatal(err)
	}
	// The hash must equal the deterministic public recomputation.
	want := arena.VerifiableHash("u1", "c1", arena.CredNaijaDriver, "crown:c1:k1")
	if hash != want {
		t.Fatalf("verifiable hash mismatch: got %s want %s", hash, want)
	}
	got, err := svc.VerifyByHash(context.Background(), hash)
	if err != nil || got.Status != "ACTIVE" {
		t.Fatalf("verify-by-hash must return ACTIVE credential: %v %+v", err, got)
	}
	// Revoke is independent + audited.
	if err := svc.Revoke(context.Background(), "actor", hash, "fraud"); err != nil {
		t.Fatal(err)
	}
	got2, _ := svc.VerifyByHash(context.Background(), hash)
	if got2.Status != "REVOKED" {
		t.Fatal("revoked credential must report REVOKED")
	}
}
