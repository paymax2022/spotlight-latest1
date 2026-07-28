package restaurant

import "errors"

// Object-level authorization for the order lifecycle. These are the ONLY sentinels the
// handler maps to HTTP 403 (everything else stays 400/404). Kept pure + table-testable:
// the DB-backed service resolves the order's parties, then defers the allow/deny
// decision to the functions below.
var (
	// ErrForbidden — the caller is not a party to this order (or not the party allowed
	// to make this specific transition). Object-level authZ failure.
	ErrForbidden = errors.New("restaurant: forbidden")
	// ErrDeliveredViaHandoff — `delivered` cannot be set through the generic status
	// endpoint; the assigned rider must use ConfirmHandoff, which enforces the
	// delivery-code proof-of-delivery. This closes the POD-bypass hole.
	ErrDeliveredViaHandoff = errors.New("restaurant: delivered can only be set via rider handoff (proof of delivery)")
	// ErrOutsideDeliveryZone — the delivery destination falls outside every service
	// area the restaurant's owner has defined. Only enforced when the owner has at
	// least one zone AND the request carries delivery coordinates (otherwise the order
	// is allowed, back-compat). Maps to HTTP 422 (unprocessable — valid request, but
	// undeliverable to this address).
	ErrOutsideDeliveryZone = errors.New("restaurant: delivery address is outside the restaurant's delivery zone")
	// ErrClosedNow — the restaurant has business hours defined and is currently outside
	// them (or its manual switch is off). Distinct from the generic "not found"/"closed"
	// so the handler can return 422 (valid request, not orderable at this time).
	ErrClosedNow = errors.New("restaurant: restaurant is closed right now (outside business hours)")
)

type orderActorRole int

const (
	roleNone orderActorRole = iota
	roleOwner
	roleRider
	roleCustomer
)

// classifyOrderActor resolves the caller's role for a specific order from that order's
// resolved parties. Precedence: restaurant owner, then the assigned rider, then the
// customer. An empty actor, or an actor matching none of the parties, is roleNone.
func classifyOrderActor(actorID, customer, owner, rider string) orderActorRole {
	switch {
	case actorID == "":
		return roleNone
	case actorID == owner:
		return roleOwner
	case rider != "" && actorID == rider:
		return roleRider
	case actorID == customer:
		return roleCustomer
	default:
		return roleNone
	}
}

// authorizeStatusChange decides whether actorID may drive the order to `to` via the
// generic status endpoint, given the order's parties. Only the order's own
// owner/rider/customer may act (object-level), and only on the transitions their role
// owns:
//   - owner:    confirmed, preparing, ready, cancelled
//   - rider:    picked_up
//   - customer: cancelled
//   - delivered: NEVER here — must go through ConfirmHandoff (POD).
//
// This does not check the FROM→TO edge validity — that stays the state-machine guard's
// job (canTransition); this only answers "may THIS caller attempt THIS target".
func authorizeStatusChange(actorID, customer, owner, rider string, to OrderStatus) error {
	if to == OrderDelivered {
		return ErrDeliveredViaHandoff
	}
	role := classifyOrderActor(actorID, customer, owner, rider)
	switch to {
	case OrderConfirmed, OrderPreparing, OrderReady:
		if role == roleOwner {
			return nil
		}
	case OrderPickedUp:
		if role == roleRider {
			return nil
		}
	case OrderCancelled:
		if role == roleOwner || role == roleCustomer {
			return nil
		}
	}
	return ErrForbidden
}

// authorizeCancel decides whether actorID may cancel + refund the order — its customer
// or the restaurant owner (an admin path, if any, is separate). Riders and strangers
// may not.
func authorizeCancel(actorID, customer, owner, rider string) error {
	switch classifyOrderActor(actorID, customer, owner, rider) {
	case roleOwner, roleCustomer:
		return nil
	default:
		return ErrForbidden
	}
}
