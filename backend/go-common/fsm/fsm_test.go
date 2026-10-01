package fsm_test

import (
	"testing"

	"spotlight/backend/go-common/fsm"
)

type status string

const (
	pending   status = "pending"
	confirmed status = "confirmed"
	preparing status = "preparing"
	delivered status = "delivered"
	cancelled status = "cancelled"
)

var orderMoves = fsm.Table[status]{
	pending:   fsm.Set(confirmed, cancelled),
	confirmed: fsm.Set(preparing, cancelled),
	preparing: fsm.Set(delivered, cancelled),
	delivered: fsm.Set[status](),
	cancelled: fsm.Set[status](),
}

func TestCan(t *testing.T) {
	if !orderMoves.Can(pending, confirmed) {
		t.Fatal("pending→confirmed must be legal")
	}
	if !orderMoves.Can(preparing, delivered) {
		t.Fatal("preparing→delivered must be legal")
	}
	if orderMoves.Can(delivered, pending) {
		t.Fatal("delivered→pending must be illegal")
	}
	if orderMoves.Can(pending, delivered) {
		t.Fatal("pending→delivered (skip) must be illegal")
	}
}

func TestCan_SelfLoopNeverLegal(t *testing.T) {
	if orderMoves.Can(pending, pending) {
		t.Fatal("self-loop must never be legal")
	}
	// even when the table declares one
	t2 := fsm.Table[status]{pending: fsm.Set(pending)}
	if t2.Can(pending, pending) {
		t.Fatal("declared self-loop must still be rejected")
	}
}

func TestIsTerminal(t *testing.T) {
	if !orderMoves.IsTerminal(delivered) || !orderMoves.IsTerminal(cancelled) {
		t.Fatal("delivered/cancelled must be terminal")
	}
	if orderMoves.IsTerminal(pending) {
		t.Fatal("pending is not terminal")
	}
}

func TestLegal(t *testing.T) {
	got := orderMoves.Legal(pending)
	if len(got) != 2 {
		t.Fatalf("Legal(pending) = %v, want 2 moves", got)
	}
	if orderMoves.Legal(delivered) != nil {
		t.Fatal("Legal(terminal) must be nil")
	}
}

func TestReachable(t *testing.T) {
	if !orderMoves.Reachable(pending, delivered) {
		t.Fatal("pending→delivered must be reachable")
	}
	if orderMoves.Reachable(delivered, pending) {
		t.Fatal("delivered→pending must not be reachable")
	}
	if orderMoves.Reachable(pending, pending) {
		t.Fatal("from==to must be false (same as Can)")
	}
}

func TestValidate_CatchesSelfLoop(t *testing.T) {
	bad := fsm.Table[status]{pending: fsm.Set(pending)}
	got := bad.Validate()
	if len(got) != 1 || got[0] != pending {
		t.Fatalf("Validate = %v, want [pending]", got)
	}
	if len(orderMoves.Validate()) != 0 {
		t.Fatal("clean table must validate empty")
	}
}

func TestEdges(t *testing.T) {
	if n := len(orderMoves.Edges()); n != 6 {
		t.Fatalf("Edges = %d, want 6", n)
	}
}

func TestTerminalOf(t *testing.T) {
	term := fsm.TerminalOf(delivered, cancelled)
	if !term(delivered) || !term(cancelled) || term(pending) {
		t.Fatal("TerminalOf predicate wrong")
	}
}

func TestMerge(t *testing.T) {
	extra := fsm.Table[status]{delivered: fsm.Set(cancelled)} // admin override
	merged := orderMoves.Merge(extra)
	if !merged.Can(delivered, cancelled) {
		t.Fatal("merged edge missing")
	}
	if !merged.Can(pending, confirmed) {
		t.Fatal("base edge lost in merge")
	}
	// original table untouched
	if orderMoves.Can(delivered, cancelled) {
		t.Fatal("Merge mutated the base table")
	}
}

func TestStates(t *testing.T) {
	if n := len(orderMoves.States()); n != 5 {
		t.Fatalf("States = %d, want 5", n)
	}
}
