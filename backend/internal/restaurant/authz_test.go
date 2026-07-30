package restaurant

import (
	"errors"
	"testing"
)

const (
	owner    = "owner-1"
	rider    = "rider-1"
	customer = "cust-1"
	stranger = "stranger-x"
)

func TestClassifyOrderActor(t *testing.T) {
	cases := []struct {
		name, actor string
		riderSet    string
		want        orderActorRole
	}{
		{"owner", owner, rider, roleOwner},
		{"assigned rider", rider, rider, roleRider},
		{"customer", customer, rider, roleCustomer},
		{"stranger", stranger, rider, roleNone},
		{"empty actor", "", rider, roleNone},
		{"rider id but no rider assigned", rider, "", roleNone}, // rider only counts when assigned
		{"owner precedence when actor is also customer", owner, rider, roleOwner},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := classifyOrderActor(c.actor, customer, owner, c.riderSet); got != c.want {
				t.Fatalf("classifyOrderActor(%q) = %d; want %d", c.actor, got, c.want)
			}
		})
	}
}

func TestAuthorizeStatusChange(t *testing.T) {
	type tc struct {
		name    string
		actor   string
		to      OrderStatus
		wantErr error // nil = allowed
	}
	cases := []tc{
		// Owner owns the kitchen-side transitions.
		{"owner→confirmed", owner, OrderConfirmed, nil},
		{"owner→preparing", owner, OrderPreparing, nil},
		{"owner→ready", owner, OrderReady, nil},
		{"owner→cancelled", owner, OrderCancelled, nil},
		// Rider owns pickup only.
		{"rider→picked_up", rider, OrderPickedUp, nil},
		// Customer may cancel.
		{"customer→cancelled", customer, OrderCancelled, nil},

		// delivered is NEVER allowed via this endpoint (POD bypass closed).
		{"owner→delivered blocked", owner, OrderDelivered, ErrDeliveredViaHandoff},
		{"rider→delivered blocked", rider, OrderDelivered, ErrDeliveredViaHandoff},
		{"customer→delivered blocked", customer, OrderDelivered, ErrDeliveredViaHandoff},

		// Wrong role for the transition → forbidden.
		{"rider→confirmed forbidden", rider, OrderConfirmed, ErrForbidden},
		{"rider→ready forbidden", rider, OrderReady, ErrForbidden},
		{"customer→ready forbidden", customer, OrderReady, ErrForbidden},
		{"customer→picked_up forbidden", customer, OrderPickedUp, ErrForbidden},
		{"owner→picked_up forbidden", owner, OrderPickedUp, ErrForbidden},
		{"rider→cancelled forbidden", rider, OrderCancelled, ErrForbidden},

		// Strangers can do nothing (object-level authZ) — the core S1 fix.
		{"stranger→confirmed forbidden", stranger, OrderConfirmed, ErrForbidden},
		{"stranger→ready forbidden", stranger, OrderReady, ErrForbidden},
		{"stranger→picked_up forbidden", stranger, OrderPickedUp, ErrForbidden},
		{"stranger→cancelled forbidden", stranger, OrderCancelled, ErrForbidden},
		{"stranger→delivered blocked (POD first)", stranger, OrderDelivered, ErrDeliveredViaHandoff},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := authorizeStatusChange(c.actor, customer, owner, rider, c.to)
			if c.wantErr == nil && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if c.wantErr != nil && !errors.Is(err, c.wantErr) {
				t.Fatalf("expected %v, got %v", c.wantErr, err)
			}
		})
	}
}

func TestAuthorizeCancel(t *testing.T) {
	cases := []struct {
		name, actor string
		wantErr     error
	}{
		{"owner allowed", owner, nil},
		{"customer allowed", customer, nil},
		{"rider forbidden", rider, ErrForbidden},
		{"stranger forbidden", stranger, ErrForbidden},
		{"empty forbidden", "", ErrForbidden},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := authorizeCancel(c.actor, customer, owner, rider)
			if c.wantErr == nil && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if c.wantErr != nil && !errors.Is(err, c.wantErr) {
				t.Fatalf("expected %v, got %v", c.wantErr, err)
			}
		})
	}
}
