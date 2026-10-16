package orchestration

import (
	"context"
	"testing"
	"time"

	"spotlight/backend/internal/crossborder/onboarding"
)

type recordingApplier struct {
	company string
	ev      onboarding.NormalizedAccountEvent
	calls   int
}

func (r *recordingApplier) HandleProviderStatus(_ context.Context, c string, ev onboarding.NormalizedAccountEvent) error {
	r.company, r.ev = c, ev
	r.calls++
	return nil
}

func TestVertoFXWebhook_AccountEventRoutedToOnboarding(t *testing.T) {
	rec := &recordingApplier{}
	svc := NewService([]Provider{stubProvider{name: "vertofx"}}, NewMemStore(), Options{Now: time.Now}, WithAccountLifecycle(rec))
	ctx := context.Background()

	body := `{"id":"e1","event":"sub_account_approved","data":{"companyId":"co-9"}}`
	if err := svc.HandleProviderEvent(ctx, "vertofx", []byte(body)); err != nil {
		t.Fatal(err)
	}
	if rec.calls != 1 || rec.company != "co-9" || rec.ev.Name != "account.approved" || rec.ev.EventID != "e1" {
		t.Fatalf("not routed: %+v", rec)
	}

	// No company id: logged, not applied.
	if err := svc.HandleProviderEvent(ctx, "vertofx", []byte(`{"id":"e2","event":"account.rejected"}`)); err != nil {
		t.Fatal(err)
	}
	if rec.calls != 1 {
		t.Fatal("event without company id must not be applied")
	}
}
