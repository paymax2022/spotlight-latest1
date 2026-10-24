package top5events_test

// Unit tests for the organiser-gate flag semantics (EVTA-D001). No DB — the
// gate must short-circuit before touching the pool when off, and fail closed
// for an empty caller even when on.

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/top5events"
)

func TestOrganiserGate_OffIsLegacy(t *testing.T) {
	svc := top5events.NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	if svc.OrganiserGateEnabled() {
		t.Fatal("gate must default to off")
	}
	ok, err := svc.CanOrganise(context.Background(), "any-user")
	if err != nil || !ok {
		t.Fatalf("gate off: CanOrganise = %v, %v — want true, nil (legacy)", ok, err)
	}
	el, err := svc.Eligibility(context.Background(), "any-user")
	if err != nil {
		t.Fatalf("Eligibility: %v", err)
	}
	if el.GateEnabled || !el.CanOrganise {
		t.Fatalf("gate off: eligibility = %+v — want gate_enabled=false, can_organise=true", el)
	}
	if el.MerchantTypeID != top5events.OrganiserMerchantTypeID {
		t.Fatalf("merchant_type_id = %q, want %q", el.MerchantTypeID, top5events.OrganiserMerchantTypeID)
	}
}

func TestOrganiserGate_OnEmptyCallerFailsClosed(t *testing.T) {
	svc := top5events.NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	svc.SetOrganiserGate(true)
	if !svc.OrganiserGateEnabled() {
		t.Fatal("SetOrganiserGate(true) did not take")
	}
	ok, err := svc.CanOrganise(context.Background(), "")
	if err != nil || ok {
		t.Fatalf("gate on, empty caller: CanOrganise = %v, %v — want false, nil", ok, err)
	}
}

func TestOrganiserGate_ErrWrapsForbidden(t *testing.T) {
	if !errors.Is(top5events.ErrOrganiserRequired, top5events.ErrForbidden) {
		t.Fatal("ErrOrganiserRequired must wrap ErrForbidden so every error mapper answers 403")
	}
}
