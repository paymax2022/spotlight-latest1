package providerimport

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

type fakeSource struct {
	configured bool
	all        []Summary
	failOnPage int // 0 = never
	calls      int
}

func (f *fakeSource) Configured() bool { return f.configured }
func (f *fakeSource) ListSummaries(_ context.Context, page, limit int) ([]Summary, int, error) {
	f.calls++
	if f.failOnPage == page {
		return nil, 0, errors.New("provider timeout")
	}
	start := (page - 1) * limit
	if start >= len(f.all) {
		return nil, len(f.all), nil
	}
	end := start + limit
	if end > len(f.all) {
		end = len(f.all)
	}
	return f.all[start:end], len(f.all), nil
}

type fakeStore struct{ seen map[string]Summary }

func newStore() *fakeStore { return &fakeStore{seen: map[string]Summary{}} }
func (s *fakeStore) Upsert(_ context.Context, _ string, x Summary) (bool, error) {
	_, existed := s.seen[x.ProviderPolicyRef]
	s.seen[x.ProviderPolicyRef] = x
	return !existed, nil
}
func (s *fakeStore) List(context.Context, string, *bool, int, int) ([]Row, error) { return nil, nil }
func (s *fakeStore) Overview(context.Context, string) (Overview, error)           { return Overview{}, nil }

func policies(n int) []Summary {
	out := make([]Summary, n)
	for i := range out {
		out[i] = Summary{ProviderPolicyRef: fmt.Sprintf("ref-%03d", i), PremiumKobo: 10000}
	}
	return out
}

func TestSync_PagesThroughEverythingAndCountsInserts(t *testing.T) {
	src := &fakeSource{configured: true, all: policies(250)} // 3 pages of 100
	store := newStore()
	res, err := NewService("mycover", src, store, nil).Sync(context.Background(), "admin-1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Fetched != 250 || res.Inserted != 250 || res.Updated != 0 || res.ProviderTotal != 250 {
		t.Fatalf("result = %+v", res)
	}
	if len(store.seen) != 250 {
		t.Fatalf("stored %d, want 250", len(store.seen))
	}
}

func TestSync_RerunIsIdempotent(t *testing.T) {
	src := &fakeSource{configured: true, all: policies(10)}
	store := newStore()
	svc := NewService("mycover", src, store, nil)
	if _, err := svc.Sync(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Sync(context.Background(), "a")
	if err != nil {
		t.Fatal(err)
	}
	if res.Inserted != 0 || res.Updated != 10 || len(store.seen) != 10 {
		t.Fatalf("second run must update, not duplicate: %+v stored=%d", res, len(store.seen))
	}
}

func TestSync_NotConfiguredDoesNotCallProvider(t *testing.T) {
	src := &fakeSource{configured: false, all: policies(3)}
	_, err := NewService("mycover", src, newStore(), nil).Sync(context.Background(), "a")
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
	if src.calls != 0 {
		t.Fatal("must not call an unconfigured provider")
	}
}

func TestSync_ProviderFailureReportsPartialProgress(t *testing.T) {
	src := &fakeSource{configured: true, all: policies(250), failOnPage: 2}
	store := newStore()
	res, err := NewService("mycover", src, store, nil).Sync(context.Background(), "a")
	if err == nil {
		t.Fatal("want an error when a page fails")
	}
	if res.Fetched != 100 || len(store.seen) != 100 {
		t.Fatalf("page 1 was written before the failure; got fetched=%d stored=%d", res.Fetched, len(store.seen))
	}
}

func TestSync_AuditsOnSuccessOnly(t *testing.T) {
	var actions []string
	audit := func(_ context.Context, _ string, action string, _ map[string]any) { actions = append(actions, action) }

	ok := NewService("mycover", &fakeSource{configured: true, all: policies(2)}, newStore(), audit)
	if _, err := ok.Sync(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
	bad := NewService("mycover", &fakeSource{configured: true, all: policies(250), failOnPage: 1}, newStore(), audit)
	_, _ = bad.Sync(context.Background(), "a")

	if len(actions) != 1 || actions[0] != "insurance.provider_import_sync" {
		t.Fatalf("audit actions = %v", actions)
	}
}
