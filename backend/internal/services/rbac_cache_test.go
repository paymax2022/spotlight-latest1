package services_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"spotlight/backend/internal/services"
)

// stubRBAC embeds the interface so it satisfies RBACService with only the
// methods under test implemented; calling anything else panics (nil inner).
type stubRBAC struct {
	services.RBACService

	statusCalls, rolesCalls, permsCalls atomic.Int32
	statusErr                           error
}

func (s *stubRBAC) GetUserStatus(context.Context, string) (string, error) {
	s.statusCalls.Add(1)
	return "active", s.statusErr
}
func (s *stubRBAC) GetUserRoles(context.Context, string) ([]string, error) {
	s.rolesCalls.Add(1)
	return []string{"member"}, nil
}
func (s *stubRBAC) GetUserPermissions(context.Context, string, string, string) ([]string, error) {
	s.permsCalls.Add(1)
	return []string{"wallet.read"}, nil
}
func (s *stubRBAC) SuspendUser(string) error { return nil }

func TestCachedRBAC_CachesWithinTTL(t *testing.T) {
	stub := &stubRBAC{}
	c := services.NewCachedRBACService(stub, time.Minute)
	for range 5 {
		if _, err := c.GetUserStatus(t.Context(), "u1"); err != nil {
			t.Fatal(err)
		}
		if _, err := c.GetUserRoles(t.Context(), "u1"); err != nil {
			t.Fatal(err)
		}
		if _, err := c.GetUserPermissions(t.Context(), "u1", "global", ""); err != nil {
			t.Fatal(err)
		}
	}
	if stub.statusCalls.Load() != 1 || stub.rolesCalls.Load() != 1 || stub.permsCalls.Load() != 1 {
		t.Fatalf("want 1 upstream call each, got %d/%d/%d",
			stub.statusCalls.Load(), stub.rolesCalls.Load(), stub.permsCalls.Load())
	}
}

func TestCachedRBAC_ExpiresAfterTTL(t *testing.T) {
	stub := &stubRBAC{}
	c := services.NewCachedRBACService(stub, 20*time.Millisecond)
	if _, err := c.GetUserStatus(t.Context(), "u1"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if _, err := c.GetUserStatus(t.Context(), "u1"); err != nil {
		t.Fatal(err)
	}
	if stub.statusCalls.Load() != 2 {
		t.Fatalf("stale entry should have re-fetched; got %d calls", stub.statusCalls.Load())
	}
}

func TestCachedRBAC_ErrorsNotCached(t *testing.T) {
	stub := &stubRBAC{statusErr: errors.New("upstream down")}
	c := services.NewCachedRBACService(stub, time.Minute)
	if _, err := c.GetUserStatus(t.Context(), "u1"); err == nil {
		t.Fatal("want upstream error")
	}
	stub.statusErr = nil
	v, err := c.GetUserStatus(t.Context(), "u1")
	if err != nil || v != "active" {
		t.Fatalf("second call should re-fetch after error: v=%q err=%v", v, err)
	}
	if stub.statusCalls.Load() != 2 {
		t.Fatalf("want 2 calls, got %d", stub.statusCalls.Load())
	}
}

func TestCachedRBAC_MutationInvalidates(t *testing.T) {
	stub := &stubRBAC{}
	c := services.NewCachedRBACService(stub, time.Minute)
	if _, err := c.GetUserStatus(t.Context(), "u1"); err != nil {
		t.Fatal(err)
	}
	if err := c.SuspendUser("u1"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetUserStatus(t.Context(), "u1"); err != nil {
		t.Fatal(err)
	}
	if stub.statusCalls.Load() != 2 {
		t.Fatalf("mutation should invalidate cache; got %d calls", stub.statusCalls.Load())
	}
}
