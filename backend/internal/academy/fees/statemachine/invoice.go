package feesstatemachine

// ── Invoice state machine (build-spec §3.1) ───────────────────────────────────
//
//	draft → issued → partially_paid ⇄ (Payment events) → paid
//	issued/partially_paid → overdue (due_date passed, balance > 0)
//	overdue → partially_paid | paid  (payments land after going overdue)
//	overdue → frozen (human-approved hardship request only — SF-9)
//	any non-terminal state → waived      (admin/scholarship override, audited)
//	any non-terminal state → written_off (admin write-off, audited)
//	Terminal: paid, waived, written_off
//
// SF-2 (CRITICAL): this machine governs INVOICE STATUS ONLY. Balance is a
// DERIVED value computed elsewhere from the sum of Payment events against the
// invoice (mirrors ledger discipline). This library MUST NEVER compute, store,
// or accept a balance/amount — no field here holds money, and no transition
// takes an amount. Whether a payment leaves the invoice `partially_paid` or
// moves it to `paid` is decided by the caller from the derived balance; it then
// emits the corresponding event. There is deliberately no `UPDATE ... balance`
// concept anywhere in this package.

// InvoiceState mirrors the Invoice.status set (build-spec §2, §3.1) and the
// academy_fees_invoices.status CHECK constraint.
type InvoiceState string

const (
	InvoiceDraft         InvoiceState = "draft"
	InvoiceIssued        InvoiceState = "issued"
	InvoicePartiallyPaid InvoiceState = "partially_paid"
	InvoicePaid          InvoiceState = "paid"
	InvoiceOverdue       InvoiceState = "overdue"
	InvoiceFrozen        InvoiceState = "frozen"
	InvoiceWaived        InvoiceState = "waived"
	InvoiceWrittenOff    InvoiceState = "written_off"
)

// Invoice events.
const (
	EvInvoiceIssue       Event = "issue"        // draft → issued
	EvInvoicePayPartial  Event = "pay_partial"  // issued/overdue → partially_paid; partially_paid self-loop
	EvInvoicePayFull     Event = "pay_full"     // issued/partially_paid/overdue → paid
	EvInvoiceMarkOverdue Event = "mark_overdue" // issued/partially_paid → overdue
	EvInvoiceFreeze      Event = "freeze"       // overdue → frozen (SF-9, human-approved)
	EvInvoiceWaive       Event = "waive"        // any non-terminal → waived
	EvInvoiceWriteOff    Event = "write_off"    // any non-terminal → written_off
)

// invoiceNonTerminal is the set of states from which waive / write_off are legal
// (the "any non-terminal state" clause in §3.1). Terminal states are excluded so
// the "any pre-terminal state → waived/written_off" rule can't reopen a closed
// invoice.
var invoiceNonTerminal = map[InvoiceState]bool{
	InvoiceDraft:         true,
	InvoiceIssued:        true,
	InvoicePartiallyPaid: true,
	InvoiceOverdue:       true,
	InvoiceFrozen:        true,
}

// invoiceTerminal is the terminal set (§3.1): no outgoing transitions.
var invoiceTerminal = map[InvoiceState]bool{
	InvoicePaid:       true,
	InvoiceWaived:     true,
	InvoiceWrittenOff: true,
}

// invoiceTransitions is the explicit legal adjacency for the invoice SM. The
// "any non-terminal → waived/written_off" edges are NOT enumerated per-state
// here; they are handled uniformly in Transition via invoiceNonTerminal so the
// table stays readable and the fan-in edges can't drift out of sync.
var invoiceTransitions = map[InvoiceState]map[InvoiceState]bool{
	InvoiceDraft:         {InvoiceIssued: true},
	InvoiceIssued:        {InvoicePartiallyPaid: true, InvoicePaid: true, InvoiceOverdue: true},
	InvoicePartiallyPaid: {InvoicePartiallyPaid: true, InvoicePaid: true, InvoiceOverdue: true},
	InvoiceOverdue:       {InvoicePartiallyPaid: true, InvoicePaid: true, InvoiceFrozen: true},
	InvoiceFrozen:        {}, // only waive/write_off (handled via invoiceNonTerminal)
	InvoicePaid:          {}, // terminal
	InvoiceWaived:        {}, // terminal
	InvoiceWrittenOff:    {}, // terminal
}

// validInvoiceState reports whether s is a known invoice state.
func validInvoiceState(s InvoiceState) bool {
	if invoiceTerminal[s] {
		return true
	}
	return invoiceNonTerminal[s]
}

// invoiceTarget resolves the target state for an event given the current state,
// or "" if the event is not applicable here. Kept separate from the adjacency
// check so the fan-in (waive/write_off) events are expressed once.
func invoiceTarget(from InvoiceState, event Event) InvoiceState {
	switch event {
	case EvInvoiceIssue:
		return InvoiceIssued
	case EvInvoicePayPartial:
		return InvoicePartiallyPaid
	case EvInvoicePayFull:
		return InvoicePaid
	case EvInvoiceMarkOverdue:
		return InvoiceOverdue
	case EvInvoiceFreeze:
		return InvoiceFrozen
	case EvInvoiceWaive:
		return InvoiceWaived
	case EvInvoiceWriteOff:
		return InvoiceWrittenOff
	default:
		return ""
	}
}

// InvoiceCanTransition reports whether from→to is a legal invoice transition.
// Pure. Includes the "any non-terminal → waived/written_off" fan-in edges.
//
// NOTE: Go has no method overloading, so the four machines in this single
// package cannot each literally export a symbol named `CanTransition`. Each
// machine therefore exports its own `<Machine>CanTransition` /
// `<Machine>Transition` pair with identical semantics to the spec's generic
// `CanTransition(from, to) bool` / `Transition(from, event) (State, error)`.
func InvoiceCanTransition(from, to InvoiceState) bool {
	// Fan-in edges: waive / write_off from any non-terminal state.
	if (to == InvoiceWaived || to == InvoiceWrittenOff) && invoiceNonTerminal[from] {
		return true
	}
	targets, ok := invoiceTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// InvoiceTransition applies an event to the invoice machine and returns the
// resulting state or a typed error. Idempotent partially_paid→partially_paid (a
// further installment that does not clear the balance) is a legal explicit edge
// and returns partially_paid with no error; firing an event whose target equals
// the current state on a NON-self-loop state returns ErrAlreadyInState.
func InvoiceTransition(from InvoiceState, event Event) (InvoiceState, error) {
	if !validInvoiceState(from) {
		return from, ErrIllegalTransition
	}
	to := invoiceTarget(from, event)
	if to == "" {
		return from, ErrIllegalTransition
	}
	// Terminal states reject every outgoing event.
	if invoiceTerminal[from] {
		return from, ErrTerminal
	}
	if InvoiceCanTransition(from, to) {
		return to, nil
	}
	// The event resolved to a real state but the edge is not permitted from here.
	// If that target IS the current state (and not the explicit partially_paid
	// self-loop, which CanTransition already accepted), report the idempotent
	// no-op rather than a hard illegal-transition error.
	if to == from {
		return from, ErrAlreadyInState
	}
	return from, ErrIllegalTransition
}
