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

// Legal lists the states reachable from s — for "what next" admin UI hints
// and for tests asserting the transition surface.
func (t Table[S]) Legal(from S) []S {
	m, ok := t[from]
	if !ok {
		return nil
	}
	out := make([]S, 0, len(m))
	for s := range m {
		out = append(out, s)
	}
	return out
}

// IsTerminal reports whether s has no outgoing moves in this table — the
// IsTerminal helper's map-driven form.
func (t Table[S]) IsTerminal(s S) bool {
	return len(t[s]) == 0
}

// States returns every state that appears as a from key — the declared
// state space for validation and diagnostics.
func (t Table[S]) States() []S {
	out := make([]S, 0, len(t))
	for s := range t {
		out = append(out, s)
	}
	return out
}

// TerminalOf builds the terminal-state predicate for an explicit set — for
// modules whose "done" states are a named constant group rather than derived
// from the table: `var terminal = fsm.TerminalOf(OrderDelivered, OrderCancelled)`.
func TerminalOf[S comparable](states ...S) func(S) bool {
	set := Set(states...)
	return func(s S) bool { return set[s] }
}

// Reachable reports whether `to` can be reached from `from` through any
// number of legal moves — BFS over the table. Used by admin tooling that
// must answer "can this record ever reach state X" (e.g. refund eligibility),
// and by tests asserting that dead-ends are truly terminal.
func (t Table[S]) Reachable(from, to S) bool {
	if from == to {
		return false
	}
	seen := map[S]bool{from: true}
	queue := []S{from}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for next := range t[cur] {
			if next == to {
				return true
			}
			if !seen[next] {
				seen[next] = true
				queue = append(queue, next)
			}
		}
	}
	return false
}

// Validate checks the table for self-loops — a Can() never permits them, so
// a literal that declares one is a bug worth surfacing in module init tests.
// Returns the offending states (empty when the table is clean).
func (t Table[S]) Validate() []S {
	var bad []S
	for from, m := range t {
		if m[from] {
			bad = append(bad, from)
		}
	}
	return bad
}

// Edges returns every legal (from,to) pair — the full transition surface for
// documentation dumps and contract tests that snapshot the machine.
func (t Table[S]) Edges() [][2]S {
	var out [][2]S
	for from, m := range t {
		for to := range m {
			out = append(out, [2]S{from, to})
		}
	}
	return out
}

// Merge overlays another table onto this one — modules that extend a shared
// base lifecycle (e.g. extra admin-only transitions) compose rather than
// redeclare. Existing edges are OR-ed, never removed.
func (t Table[S]) Merge(other Table[S]) Table[S] {
	out := make(Table[S], len(t)+len(other))
	for from, m := range t {
		out[from] = Set[S]()
		for to := range m {
			out[from][to] = true
		}
	}
	for from, m := range other {
		if out[from] == nil {
			out[from] = Set[S]()
		}
		for to := range m {
			out[from][to] = true
		}
	}
	return out
}
