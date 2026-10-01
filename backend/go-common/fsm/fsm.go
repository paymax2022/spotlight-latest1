// Package fsm replaces the per-module canTransition / IsTerminal helpers.
// Modules declare their legal moves once as a literal; the generic Table
// answers Can(from, to) — replacing both the map-driven implementations
// (transport, scheduling) and, where convenient, switch-driven ones.
package fsm

// Table is a transition map: Table[from][to] == true means legal.
// Declare it as a package-level literal beside the status constants:
//
//	var orderMoves = fsm.Table[OrderStatus]{
//		OrderPending:   fsm.Set(OrderConfirmed, OrderCancelled, OrderRejected),
//		OrderConfirmed: fsm.Set(OrderPreparing, OrderCancelled, OrderRejected),
//	}
type Table[S comparable] map[S]map[S]bool

// Set builds the to-state set for a Table literal.
func Set[S comparable](states ...S) map[S]bool {
	m := make(map[S]bool, len(states))
	for _, s := range states {
		m[s] = true
	}
	return m
}

// Can reports whether moving from→to is permitted. from == to is never legal
// — self-loops matched every audited implementation's guard.
func (t Table[S]) Can(from, to S) bool {
	if from == to {
		return false
	}
	m, ok := t[from]
	if !ok {
		return false
	}
	return m[to]
}

// IsTerminal reports whether s has no outgoing moves in this table — the
// IsTerminal helper's map-driven form.
func (t Table[S]) IsTerminal(s S) bool {
	return len(t[s]) == 0
}

// TerminalOf builds the terminal-state predicate for an explicit set — for
// modules whose "done" states are a named constant group rather than derived
// from the table: `var terminal = fsm.TerminalOf(OrderDelivered, OrderCancelled)`.
func TerminalOf[S comparable](states ...S) func(S) bool {
	set := Set(states...)
	return func(s S) bool { return set[s] }
}
