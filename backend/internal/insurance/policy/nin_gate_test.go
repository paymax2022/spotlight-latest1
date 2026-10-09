package policy

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/provider"
)

// The member purchase path must require a Dojah-verified NIN BEFORE the policy
// row or any ledger leg exists (FEATURE_INSURANCE_NIN_REQUIRED, default ON).
// The gate is fail-closed at every step: no verifier, a provider error, or a
// non-verdict are all refusals — never a silent pass.
//
// Ordering is asserted structurally: the service under test is built with a
// NIL repository. If a refused gate ever ran after a DB touch, the test would
// panic on the nil pool instead of returning the sentinel.

type fakeIdNumber struct {
	res   provider.KycCheckResult
	err   error
	calls int
	got   provider.KycVerifyRequest
}

func (f *fakeIdNumber) Name() string { return "fake-id" }

func (f *fakeIdNumber) VerifyIDNumber(_ context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	f.calls++
	f.got = req
	return f.res, f.err
}

func ninPass() provider.KycCheckResult {
	return provider.KycCheckResult{Status: provider.KycPassed, Match: true, Terminal: true}
}

func TestVerifyNIN_FlagOffSkipsEntirely(t *testing.T) {
	fake := &fakeIdNumber{res: ninPass()}
	svc := NewService(Deps{NINRequired: false, NINVerifier: fake})
	for _, nin := range []string{"", "not-a-nin", "12345678901"} {
		if err := svc.verifyNIN(context.Background(), "u1", nin); err != nil {
			t.Fatalf("flag off must skip every input, got %v for %q", err, nin)
		}
	}
	if fake.calls != 0 {
		t.Fatalf("flag off must never call the provider, got %d calls", fake.calls)
	}
}

func TestVerifyNIN_MissingIsRequired(t *testing.T) {
	fake := &fakeIdNumber{res: ninPass()}
	svc := NewService(Deps{NINRequired: true, NINVerifier: fake})
	for _, nin := range []string{"", "   "} {
		if err := svc.verifyNIN(context.Background(), "u1", nin); !errors.Is(err, ErrNINRequired) {
			t.Fatalf("nin %q: want ErrNINRequired, got %v", nin, err)
		}
	}
	if fake.calls != 0 {
		t.Fatal("missing NIN must be refused before the provider call")
	}
}

func TestVerifyNIN_MalformedIsInvalid(t *testing.T) {
	fake := &fakeIdNumber{res: ninPass()}
	svc := NewService(Deps{NINRequired: true, NINVerifier: fake})
	for _, nin := range []string{"123", "123456789012", "abcdefghijk", "1234567890a", "12345 67890"} {
		if err := svc.verifyNIN(context.Background(), "u1", nin); !errors.Is(err, ErrNINInvalid) {
			t.Fatalf("nin %q: want ErrNINInvalid, got %v", nin, err)
		}
	}
	if fake.calls != 0 {
		t.Fatal("malformed NIN must be refused before the provider call")
	}
}

func TestVerifyNIN_NoVerifierFailsClosed(t *testing.T) {
	svc := NewService(Deps{NINRequired: true})
	if err := svc.verifyNIN(context.Background(), "u1", "12345678901"); !errors.Is(err, ErrNINUnavailable) {
		t.Fatalf("want ErrNINUnavailable, got %v", err)
	}
}

func TestVerifyNIN_ProviderErrorFailsClosed(t *testing.T) {
	fake := &fakeIdNumber{err: errors.New("dojah: http request: boom")}
	svc := NewService(Deps{NINRequired: true, NINVerifier: fake})
	err := svc.verifyNIN(context.Background(), "u1", "12345678901")
	if !errors.Is(err, ErrNINUnavailable) {
		t.Fatalf("want ErrNINUnavailable, got %v", err)
	}
	// The raw adapter error can embed the request URL — which carries the NIN
	// in its query — so it must never be wrapped into the returned error.
	if err != nil && errors.Is(err, fake.err) {
		t.Fatal("adapter error must not be wrapped — it can leak the NIN")
	}
}

// Unconfigured Dojah creds return a sandbox PENDING — a non-verdict, not a
// "bad NIN". Refusing it as unavailable (503) keeps the gate closed without
// telling the member their own number is wrong.
func TestVerifyNIN_NonVerdictFailsClosed(t *testing.T) {
	fake := &fakeIdNumber{res: provider.KycCheckResult{Status: provider.KycPending, Terminal: false}}
	svc := NewService(Deps{NINRequired: true, NINVerifier: fake})
	if err := svc.verifyNIN(context.Background(), "u1", "12345678901"); !errors.Is(err, ErrNINUnavailable) {
		t.Fatalf("want ErrNINUnavailable, got %v", err)
	}
}

func TestVerifyNIN_ProviderAnsweredNoIsRejected(t *testing.T) {
	for _, st := range []provider.KycCheckStatus{provider.KycFailed, provider.KycReview} {
		fake := &fakeIdNumber{res: provider.KycCheckResult{Status: st, Terminal: true}}
		svc := NewService(Deps{NINRequired: true, NINVerifier: fake})
		if err := svc.verifyNIN(context.Background(), "u1", "12345678901"); !errors.Is(err, ErrNINRejected) {
			t.Fatalf("status %s: want ErrNINRejected, got %v", st, err)
		}
	}
}

func TestVerifyNIN_PassedMatchProceeds(t *testing.T) {
	fake := &fakeIdNumber{res: ninPass()}
	svc := NewService(Deps{NINRequired: true, NINVerifier: fake})
	if err := svc.verifyNIN(context.Background(), "u1", " 12345678901 "); err != nil {
		t.Fatalf("verified NIN must pass the gate, got %v", err)
	}
	if fake.calls != 1 {
		t.Fatalf("want exactly one provider call, got %d", fake.calls)
	}
	if fake.got.IDType != "nin" || fake.got.IDNumber != "12345678901" {
		t.Fatalf("wrong provider request: id_type=%q id_number=%q", fake.got.IDType, fake.got.IDNumber)
	}
	if fake.got.UserID != "u1" || fake.got.Type != provider.KycIDNumber {
		t.Fatalf("wrong provider request: %+v", fake.got)
	}
}

// The gate runs BEFORE the saga. A refusal returns the sentinel; a pass falls
// through into bindFromQuote — which here panics on the deliberately nil repo,
// proving the gate let it proceed and that nothing touched the DB beforehand.
func TestBindWithNIN_GatePrecedesSaga(t *testing.T) {
	quoteID := uuid.New().String()

	reach := func(svc *Service, nin string) (reached bool) {
		defer func() { reached = recover() != nil }()
		_, _ = svc.BindFromQuoteWithNIN(context.Background(), "u1", quoteID, nin, "k")
		return false
	}

	for _, tc := range []struct {
		name string
		deps Deps
		nin  string
	}{
		{"missing", Deps{NINRequired: true, NINVerifier: &fakeIdNumber{res: ninPass()}}, ""},
		{"malformed", Deps{NINRequired: true, NINVerifier: &fakeIdNumber{res: ninPass()}}, "123"},
		{"rejected", Deps{NINRequired: true, NINVerifier: &fakeIdNumber{res: provider.KycCheckResult{Status: provider.KycFailed, Terminal: true}}}, "12345678901"},
		{"provider error", Deps{NINRequired: true, NINVerifier: &fakeIdNumber{err: errors.New("boom")}}, "12345678901"},
	} {
		svc := NewService(tc.deps)
		_, err := svc.BindFromQuoteWithNIN(context.Background(), "u1", quoteID, tc.nin, "k")
		if err == nil {
			t.Fatalf("%s: a refused NIN must return an error before the saga", tc.name)
		}
		if reach(NewService(tc.deps), tc.nin) {
			t.Fatalf("%s: refusal happened AFTER the saga started — ordering violated", tc.name)
		}
	}

	// A verified NIN proceeds: the nil repo panics inside the saga, which is
	// exactly the proof the gate stepped aside.
	if !reach(NewService(Deps{NINRequired: true, NINVerifier: &fakeIdNumber{res: ninPass()}}), "12345678901") {
		t.Fatal("verified NIN should reach the saga (nil repo panics past the gate)")
	}
}

// The non-NIN entry point (embedded / transport GIT binds) is deliberately NOT
// gated — those surfaces never collect a NIN. With the flag on and a
// always-failing verifier, BindFromQuote must still reach the saga.
func TestBindFromQuote_ExemptFromNINGate(t *testing.T) {
	svc := NewService(Deps{NINRequired: true, NINVerifier: &fakeIdNumber{err: errors.New("should never be called")}})
	defer func() {
		if recover() == nil {
			t.Fatal("BindFromQuote should bypass the NIN gate and reach the saga (nil repo panics)")
		}
	}()
	_, _ = svc.BindFromQuote(context.Background(), "u1", uuid.New().String(), "k")
}

func TestMapErr_NINSentinels(t *testing.T) {
	cases := []struct {
		err      error
		wantCode int
		wantKey  string
	}{
		{ErrNINRequired, http.StatusBadRequest, "nin_required"},
		{ErrNINInvalid, http.StatusBadRequest, "nin_invalid"},
		{ErrNINRejected, http.StatusBadRequest, "nin_verification_failed"},
		{ErrNINUnavailable, http.StatusServiceUnavailable, "nin_verification_unavailable"},
	}
	for _, tc := range cases {
		code, body := run(tc.err)
		if code != tc.wantCode {
			t.Errorf("mapErr(%v) = %d, want %d", tc.err, code, tc.wantCode)
		}
		if body["code"] != tc.wantKey {
			t.Errorf("mapErr(%v) code = %v, want %s", tc.err, body["code"], tc.wantKey)
		}
	}
}

// Handler-level: the bind endpoint must carry the NIN through to the gate and
// surface the gate's verdicts — 400 for member-fixable input, 503 when the
// provider cannot answer. The real (repo-less) service runs the gate for real.
func TestBind_MissingNINIs400(t *testing.T) {
	h := NewHandler(NewService(Deps{NINRequired: true, NINVerifier: &fakeIdNumber{res: ninPass()}}), nil)
	c, w := gateCtx(http.MethodPost, "/x", `{"quote_id":"`+uuid.New().String()+`"}`, "")
	h.Bind(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bind without nin = %d, want 400", w.Code)
	}
}

func TestBind_MalformedNINIs400(t *testing.T) {
	h := NewHandler(NewService(Deps{NINRequired: true, NINVerifier: &fakeIdNumber{res: ninPass()}}), nil)
	c, w := gateCtx(http.MethodPost, "/x", `{"quote_id":"`+uuid.New().String()+`","nin":"123"}`, "")
	h.Bind(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bind with malformed nin = %d, want 400", w.Code)
	}
}

func TestBind_DojahRefusalIs400(t *testing.T) {
	fake := &fakeIdNumber{res: provider.KycCheckResult{Status: provider.KycFailed, Terminal: true}}
	h := NewHandler(NewService(Deps{NINRequired: true, NINVerifier: fake}), nil)
	c, w := gateCtx(http.MethodPost, "/x", `{"quote_id":"`+uuid.New().String()+`","nin":"12345678901"}`, "")
	h.Bind(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bind with unverifiable nin = %d, want 400", w.Code)
	}
	if fake.calls != 1 {
		t.Fatalf("want one provider call, got %d", fake.calls)
	}
}

func TestBind_DojahUnreachableIs503(t *testing.T) {
	fake := &fakeIdNumber{err: errors.New("dojah: http request: boom")}
	h := NewHandler(NewService(Deps{NINRequired: true, NINVerifier: fake}), nil)
	c, w := gateCtx(http.MethodPost, "/x", `{"quote_id":"`+uuid.New().String()+`","nin":"12345678901"}`, "")
	h.Bind(c)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("bind with unreachable identity provider = %d, want 503 (fail-closed)", w.Code)
	}
}
