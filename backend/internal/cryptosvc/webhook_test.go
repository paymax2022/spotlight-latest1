package cryptosvc

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// wh wraps the Mock with a webhook capability: a delivery is "valid" when its
// body is exactly the event JSON and the header carries the right token.
type wh struct{ *cryptoprov.Mock }

func (w wh) VerifyWebhook(h map[string]string, _ []byte) error {
	if h["sig"] != "ok" {
		return cryptoprov.ErrBadSignature
	}
	return nil
}
func (w wh) ParseWebhook(body []byte) (cryptoprov.Event, error) {
	// body is "<type>|<id>"
	for i := range body {
		if body[i] == '|' {
			t, id := string(body[:i]), string(body[i+1:])
			return cryptoprov.Event{Key: "mock:" + t + ":" + id, Type: t, Ref: id, Raw: []byte(`{"id":"` + id + `"}`)}, nil
		}
	}
	return cryptoprov.Event{}, errors.New("bad body")
}

type rig struct {
	ing   *Ingest
	store *memStore
	mock  *cryptoprov.Mock
	swap  cryptoprov.Swap
}

func newRig(t *testing.T, state cryptoprov.SwapState) *rig {
	t.Helper()
	m := cryptoprov.NewMock("mock", time.Now)
	m.SetPrice("USDTNGN", decimal.RequireFromString("1500"))
	q, err := m.QuoteSwap(context.Background(), cryptoprov.SwapQuoteRequest{AccountID: "acct", From: "USDT", To: "NGN", FromAmount: decimal.RequireFromString("10")})
	if err != nil {
		t.Fatal(err)
	}
	sw, err := m.ConfirmSwap(context.Background(), "acct", q.QuoteID)
	if err != nil {
		t.Fatal(err)
	}
	reg := cryptoprov.NewRegistry("mock")
	if err := reg.Register(wh{m}); err != nil {
		t.Fatal(err)
	}
	st := newMemStore()
	st.addSwap(SwapRecord{ID: "ours-1", UserID: "u1", Provider: "mock", ProviderAccountID: "acct", ProviderSwapID: sw.ID, State: state})
	return &rig{ing: NewIngest(reg, st), store: st, mock: m, swap: sw}
}

func (r *rig) deliver(t *testing.T, typ string) (Outcome, error) {
	t.Helper()
	return r.ing.Handle(context.Background(), "mock", map[string]string{"sig": "ok"}, []byte(typ+"|"+r.swap.ID))
}

func (r *rig) state() cryptoprov.SwapState { return r.store.swaps["ours-1"].State }

func TestBadSignatureIsRejectedBeforeAnythingIsStored(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	_, err := r.ing.Handle(context.Background(), "mock", map[string]string{"sig": "forged"}, []byte("swap_transaction.completed|"+r.swap.ID))
	if !errors.Is(err, ErrBadSignature) {
		t.Fatalf("err = %v, want ErrBadSignature", err)
	}
	if len(r.store.events) != 0 {
		t.Fatal("an unauthenticated delivery was stored")
	}
}

func TestUnknownProvider(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	if _, err := r.ing.Handle(context.Background(), "nope", nil, nil); !errors.Is(err, ErrUnknownProvider) {
		t.Fatalf("err = %v", err)
	}
}

func TestCompletedEventRequeriesAndCompletes(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	out, err := r.deliver(t, "swap_transaction.completed")
	if err != nil || out != OutcomeApplied {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if r.state() != cryptoprov.SwapStateCompleted {
		t.Fatalf("state = %s", r.state())
	}
	if !r.store.swaps["ours-1"].ReceivedAmount.Equal(decimal.RequireFromString("15000")) {
		t.Fatalf("received = %s, want the re-queried 15000", r.store.swaps["ours-1"].ReceivedAmount)
	}
}

func TestWebhookPayloadAloneNeverReleasesValue(t *testing.T) {
	// The delivery says "completed" but the provider still reports pending.
	r := newRig(t, cryptoprov.SwapStateProcessing)
	out, err := r.deliver(t, "swap_transaction.completed")
	if err != nil || out != OutcomePending {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if r.state() == cryptoprov.SwapStateCompleted {
		t.Fatal("completed on the payload alone")
	}
}

func TestDuplicateDeliveryIsANoOp(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	if _, err := r.deliver(t, "swap_transaction.completed"); err != nil {
		t.Fatal(err)
	}
	out, err := r.deliver(t, "swap_transaction.completed")
	if err != nil || out != OutcomeDuplicate {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if len(r.store.transitions) != 1 {
		t.Fatalf("transitions = %v, want exactly one", r.store.transitions)
	}
}

func TestFailedEventFailsTheSwap(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapFailed)
	if out, err := r.deliver(t, "swap_transaction.failed"); err != nil || out != OutcomeApplied {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if r.state() != cryptoprov.SwapStateFailed {
		t.Fatalf("state = %s", r.state())
	}
}

func TestConfirmingWalksThroughProcessing(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateConfirming)
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	if _, err := r.deliver(t, "swap_transaction.completed"); err != nil {
		t.Fatal(err)
	}
	if got := r.store.transitions; len(got) != 2 || got[0] != "confirming>processing" || got[1] != "processing>completed" {
		t.Fatalf("transitions = %v", got)
	}
}

func TestTerminalSwapNeverRegresses(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateCompleted)
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapFailed)
	out, err := r.deliver(t, "swap_transaction.failed")
	if err != nil || out != OutcomeAlreadyFinal {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if r.state() != cryptoprov.SwapStateCompleted {
		t.Fatalf("a completed swap moved to %s", r.state())
	}
}

func TestLostRaceWithAnotherWriterIsNotAnError(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	// The reconciler completes it between our read and our write.
	r.store.onTransition = func(id string, from cryptoprov.SwapState) {
		r.store.swaps[id].State = cryptoprov.SwapStateCompleted
	}
	out, err := r.deliver(t, "swap_transaction.completed")
	if err != nil || out != OutcomeAlreadyFinal {
		t.Fatalf("out=%s err=%v", out, err)
	}
}

func TestSwapNotRecordedYetIsRetryable(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	delete(r.store.swaps, "ours-1")
	_, err := r.deliver(t, "swap_transaction.completed")
	if !errors.Is(err, ErrSwapNotRecorded) {
		t.Fatalf("err = %v", err)
	}
	if len(r.store.events) != 0 {
		t.Fatal("dedupe row kept: the provider's retry would be swallowed")
	}
}

func TestProviderRequeryFailureReleasesTheDedupeRow(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	r.mock.FailNext("getswap", &cryptoprov.APIError{Provider: "mock", Status: 503})
	if _, err := r.deliver(t, "swap_transaction.completed"); err == nil {
		t.Fatal("requery failure swallowed")
	}
	if len(r.store.events) != 0 {
		t.Fatal("dedupe row kept after a failed requery")
	}
	// The retry now succeeds.
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	if out, err := r.deliver(t, "swap_transaction.completed"); err != nil || out != OutcomeApplied {
		t.Fatalf("retry out=%s err=%v", out, err)
	}
}

func TestFailedCleanupIsReportedNotHidden(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	r.mock.FailNext("getswap", &cryptoprov.APIError{Provider: "mock", Status: 503})
	r.store.failDelete = errors.New("db down")
	_, err := r.deliver(t, "swap_transaction.completed")
	if err == nil || !errors.Is(err, ErrDedupeNotReleased) {
		t.Fatalf("err = %v, want ErrDedupeNotReleased", err)
	}
}

func TestNonSwapEventsAreRecordedAndIgnored(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	out, err := r.ing.Handle(context.Background(), "mock", map[string]string{"sig": "ok"}, []byte("deposit.successful|dep1"))
	if err != nil || out != OutcomeIgnored {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if len(r.store.events) != 1 {
		t.Fatal("event not recorded")
	}
}

func TestCompletedWithNonPositiveAmountGoesToReview(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	// A provider reporting "completed" with nothing received must not credit anyone.
	r.mock.SetSwapAmount(r.swap.ID, decimal.Zero)
	_ = r.mock.CompleteSwap(r.swap.ID, cryptoprov.SwapCompleted)
	if _, err := r.deliver(t, "swap_transaction.completed"); err != nil {
		t.Fatal(err)
	}
	if r.state() != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("state = %s, want needs_review", r.state())
	}
}

func TestStoreInsertErrorIsReturned(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	r.store.failInsert = errors.New("db down")
	if _, err := r.deliver(t, "swap_transaction.completed"); err == nil {
		t.Fatal("insert failure swallowed")
	}
}

func TestCleanupSurvivesACancelledRequestContext(t *testing.T) {
	r := newRig(t, cryptoprov.SwapStateProcessing)
	ctx, cancel := context.WithCancel(context.Background())
	// The provider call fails because the caller went away mid-request.
	r.mock.FailNext("getswap", context.Canceled)
	cancel()
	_, err := r.ing.Handle(ctx, "mock", map[string]string{"sig": "ok"}, []byte("swap_transaction.completed|"+r.swap.ID))
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrDedupeNotReleased) || len(r.store.events) != 0 {
		t.Fatalf("dedupe row stranded by a cancelled context: err=%v events=%d", err, len(r.store.events))
	}
}
