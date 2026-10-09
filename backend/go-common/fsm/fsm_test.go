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

func TestTerminalOf(t *testing.T) {
	term := fsm.TerminalOf(delivered, cancelled)
	if !term(delivered) || !term(cancelled) || term(pending) {
		t.Fatal("TerminalOf predicate wrong")
	}
}
