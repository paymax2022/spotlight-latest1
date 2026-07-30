package scheduler

import (
	"context"
	"testing"
	"time"
)

// --- Status constant values -------------------------------------------------

func TestJobStatusValues(t *testing.T) {
	cases := map[JobStatus]string{
		JobActive:    "active",
		JobPaused:    "paused",
		JobCompleted: "completed",
		JobCancelled: "cancelled",
	}
	for got, want := range cases {
		if string(got) != want {
			t.Errorf("JobStatus = %q, want %q", string(got), want)
		}
	}
}

func TestRunStatusValues(t *testing.T) {
	cases := map[RunStatus]string{
		RunPending:   "pending",
		RunSucceeded: "succeeded",
		RunFailed:    "failed",
	}
	for got, want := range cases {
		if string(got) != want {
			t.Errorf("RunStatus = %q, want %q", string(got), want)
		}
	}
}

// --- jobView (read-only projection) ----------------------------------------

func TestJobView_Accessors(t *testing.T) {
	j := Job{
		ID:          "job-1",
		OwnerUserID: "user-42",
		EntityRef:   "vault-7",
	}
	v := jobView{j}

	if got := v.ID(); got != "job-1" {
		t.Errorf("ID() = %q, want %q", got, "job-1")
	}
	if got := v.OwnerUserID(); got != "user-42" {
		t.Errorf("OwnerUserID() = %q, want %q", got, "user-42")
	}
	if got := v.EntityRef(); got != "vault-7" {
		t.Errorf("EntityRef() = %q, want %q", got, "vault-7")
	}
}

func TestJobView_PayloadValue_Present(t *testing.T) {
	j := Job{Payload: map[string]any{"amount_kobo": int64(50000), "note": "autosave"}}
	v := jobView{j}

	val, ok := v.PayloadValue("amount_kobo")
	if !ok {
		t.Fatal("PayloadValue(amount_kobo) ok = false, want true")
	}
	if got, want := val.(int64), int64(50000); got != want {
		t.Errorf("PayloadValue(amount_kobo) = %d, want %d", got, want)
	}

	val, ok = v.PayloadValue("note")
	if !ok || val.(string) != "autosave" {
		t.Errorf("PayloadValue(note) = %v, %v; want autosave, true", val, ok)
	}
}

func TestJobView_PayloadValue_MissingKey(t *testing.T) {
	v := jobView{Job{Payload: map[string]any{"x": 1}}}
	val, ok := v.PayloadValue("missing")
	if ok {
		t.Errorf("PayloadValue(missing) ok = true, want false")
	}
	if val != nil {
		t.Errorf("PayloadValue(missing) val = %v, want nil", val)
	}
}

func TestJobView_PayloadValue_NilPayload(t *testing.T) {
	v := jobView{Job{Payload: nil}}
	val, ok := v.PayloadValue("anything")
	if ok {
		t.Errorf("PayloadValue on nil payload ok = true, want false")
	}
	if val != nil {
		t.Errorf("PayloadValue on nil payload val = %v, want nil", val)
	}
}

// --- runCtx (HandlerCtx implementation) ------------------------------------

func TestRunCtx_Accessors(t *testing.T) {
	type ctxKey string
	const k ctxKey = "trace"
	baseCtx := context.WithValue(context.Background(), k, "abc")

	j := Job{
		ID:          "job-9",
		OwnerUserID: "owner-9",
		EntityRef:   "sub-9",
		Payload:     map[string]any{"plan": "pro"},
	}
	rc := runCtx{ctx: baseCtx, job: j, idemKey: "job-9:1700000000"}

	if rc.Context().Value(k) != "abc" {
		t.Errorf("Context() did not carry the wrapped value")
	}
	if got := rc.IdemKey(); got != "job-9:1700000000" {
		t.Errorf("IdemKey() = %q, want %q", got, "job-9:1700000000")
	}

	jv := rc.Job()
	if jv.ID() != "job-9" {
		t.Errorf("Job().ID() = %q, want %q", jv.ID(), "job-9")
	}
	if jv.OwnerUserID() != "owner-9" {
		t.Errorf("Job().OwnerUserID() = %q, want %q", jv.OwnerUserID(), "owner-9")
	}
	if jv.EntityRef() != "sub-9" {
		t.Errorf("Job().EntityRef() = %q, want %q", jv.EntityRef(), "sub-9")
	}
	if plan, ok := jv.PayloadValue("plan"); !ok || plan.(string) != "pro" {
		t.Errorf("Job().PayloadValue(plan) = %v, %v; want pro, true", plan, ok)
	}
}

// runCtx must satisfy HandlerCtx and its Job() must satisfy JobView.
func TestRunCtx_SatisfiesInterfaces(t *testing.T) {
	var _ HandlerCtx = runCtx{}
	var hc HandlerCtx = runCtx{ctx: context.Background(), job: Job{ID: "x"}}
	var _ JobView = hc.Job()
}

// --- NewService defaults ----------------------------------------------------

func TestNewService_Defaults(t *testing.T) {
	// nil pool is fine: constructor does not touch the DB.
	s := NewService(nil)
	if s == nil {
		t.Fatal("NewService returned nil")
	}
	if s.handlers == nil {
		t.Error("handlers map is nil, want initialized")
	}
	if s.backoffBase != 30*time.Second {
		t.Errorf("backoffBase = %v, want %v", s.backoffBase, 30*time.Second)
	}
	if s.backoffMax != 6*time.Hour {
		t.Errorf("backoffMax = %v, want %v", s.backoffMax, 6*time.Hour)
	}
}

// --- RegisterJobType / handlerFor (in-memory registry) ---------------------

func TestRegisterAndLookupHandler(t *testing.T) {
	s := NewService(nil)

	called := false
	s.RegisterJobType("savings.autosave", func(ctx HandlerCtx) error {
		called = true
		return nil
	})

	h, ok := s.handlerFor("savings.autosave")
	if !ok {
		t.Fatal("handlerFor(savings.autosave) ok = false, want true")
	}
	if err := h(runCtx{ctx: context.Background()}); err != nil {
		t.Errorf("handler returned error: %v", err)
	}
	if !called {
		t.Error("registered handler was not invoked")
	}
}

func TestHandlerFor_Unregistered(t *testing.T) {
	s := NewService(nil)
	if _, ok := s.handlerFor("does.not.exist"); ok {
		t.Error("handlerFor(unregistered) ok = true, want false")
	}
}

func TestRegisterJobType_OverwritesExisting(t *testing.T) {
	s := NewService(nil)
	s.RegisterJobType("k", func(ctx HandlerCtx) error { return nil })
	sentinel := errMarker("second")
	s.RegisterJobType("k", func(ctx HandlerCtx) error { return sentinel })

	h, ok := s.handlerFor("k")
	if !ok {
		t.Fatal("handlerFor(k) ok = false after re-register")
	}
	if err := h(runCtx{}); err != sentinel {
		t.Errorf("handler err = %v, want the second (overwriting) handler's error", err)
	}
}

type errMarker string

func (e errMarker) Error() string { return string(e) }
