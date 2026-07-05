package marketplace

import "net/http"

// Escrow Order FSM (§2.2) — the critical path. Every transition is ledger- or
// delivery-touching and explicitly guarded. NO implicit transitions.
//
//	initiated        → funded | cancelled (fund_timeout)
//	funded           → seller_accepted | cancelled (seller_reject_or_timeout)
//	seller_accepted  → in_delivery (dispatch) | cancelled
//	in_delivery      → delivered
//	delivered        → inspection_window        (immediate, per §2.2)
//	inspection_window→ released (buyer_confirm / auto_release) | disputed
//	disputed         → refunded | released | split_settled  (admin decision)
//	(terminal: released, cancelled, refunded, split_settled)
//
// INVARIANT (§2.2): every terminal state = exactly one balanced ledger posting.
// No transition may leave funds in escrow with no forward path.

var orderTransitions = map[OrderStatus]map[OrderStatus]bool{
	OrderInitiated: {
		OrderFunded:    true,
		OrderCancelled: true, // fund_timeout
	},
	OrderFunded: {
		OrderSellerAccepted: true,
		OrderCancelled:      true, // seller_reject_or_timeout → refund
	},
	OrderSellerAccepted: {
		OrderInDelivery: true, // dispatch
		OrderCancelled:  true,
	},
	OrderInDelivery: {
		OrderDelivered: true,
	},
	OrderDelivered: {
		OrderInspectionWindow: true, // immediate per §2.2
	},
	OrderInspectionWindow: {
		OrderReleased: true, // buyer_confirm | auto_release
		OrderDisputed: true, // open_dispute
	},
	OrderDisputed: {
		OrderRefunded:     true, // resolve_refund
		OrderReleased:     true, // resolve_release
		OrderSplitSettled: true, // resolve_split
	},
	// terminals
	OrderReleased:     {},
	OrderCancelled:    {},
	OrderRefunded:     {},
	OrderSplitSettled: {},
}

// canOrderTransition reports whether from → to is a legal order edge.
func canOrderTransition(from, to OrderStatus) bool {
	return orderTransitions[from][to]
}

// guardOrderTransition returns a typed error when from → to is illegal.
func guardOrderTransition(from, to OrderStatus) error {
	if !canOrderTransition(from, to) {
		return &CodedError{
			Status:  http.StatusConflict,
			Code:    CodeInvalidOrderTransition,
			Message: "illegal order transition " + string(from) + " → " + string(to),
		}
	}
	return nil
}

// orderIsTerminal reports whether the state has no outgoing edges (money settled).
func orderIsTerminal(s OrderStatus) bool {
	switch s {
	case OrderReleased, OrderCancelled, OrderRefunded, OrderSplitSettled:
		return true
	default:
		return false
	}
}

// escrowHoldsFunds reports whether an order currently holds buyer funds in escrow
// (used by the hourly reconciliation invariant: SUM(escrow) = SUM(these orders)).
func escrowHoldsFunds(s OrderStatus) bool {
	switch s {
	case OrderFunded, OrderSellerAccepted, OrderInDelivery, OrderDelivered, OrderInspectionWindow, OrderDisputed:
		return true
	default:
		return false
	}
}
