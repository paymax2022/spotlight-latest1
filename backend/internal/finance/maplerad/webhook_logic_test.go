package maplerad

import "testing"

func TestClassifyEvent(t *testing.T) {
	cases := map[string]EventKind{
		"collection.successful":  EventVACredit,
		"virtual_account.credit": EventVACredit,
		"transfer.successful":    EventTransferSuccess,
		"payout.successful":      EventTransferSuccess,
		"transfer.failed":        EventTransferFailed,
		"transfer.reversed":      EventTransferReverse,
		"bill.successful":        EventBillResult,
		"bill.failed":            EventBillResult,
		"card.created":           EventUnknown, // phase-2 / unmapped → unknown, not dropped
		"":                       EventUnknown,
	}
	for in, want := range cases {
		if got := ClassifyEvent(in); got != want {
			t.Errorf("ClassifyEvent(%q)=%q want %q", in, got, want)
		}
	}
}

// Dedupe: a first delivery processes; redeliveries are ACK no-ops. Same event_id
// delivered N times → exactly one Process.
func TestDecideDedupe_OnceThenNoOp(t *testing.T) {
	first := DecideDedupe(1)
	if !first.Process || first.AckNoOp {
		t.Errorf("first delivery must Process, got %+v", first)
	}
	processCount := 0
	if first.Process {
		processCount++
	}
	for i := 0; i < 3; i++ {
		d := DecideDedupe(0) // ON CONFLICT DO NOTHING → 0 rows on redelivery
		if d.Process || !d.AckNoOp {
			t.Errorf("redelivery %d must be AckNoOp, got %+v", i, d)
		}
		if d.Process {
			processCount++
		}
	}
	if processCount != 1 {
		t.Errorf("same event_id 4× → want exactly 1 process, got %d", processCount)
	}
}

// In-sync balances → no drift, no alert.
func TestDetectDrift_InSync(t *testing.T) {
	d := DetectDrift(1_000_000, 1_000_000)
	if !d.InSync || d.Quarantine || d.DiffKobo != 0 {
		t.Errorf("equal balances must be in sync, got %+v", d)
	}
}

// Mismatch → quarantine + signed diff, never auto-corrected.
func TestDetectDrift_Quarantine(t *testing.T) {
	// Provider holds more than the ledger says.
	d := DetectDrift(1_000_000, 1_000_500)
	if d.InSync || !d.Quarantine {
		t.Errorf("mismatch must quarantine, got %+v", d)
	}
	if d.DiffKobo != 500 {
		t.Errorf("diff = %d, want 500 (provider − internal)", d.DiffKobo)
	}
	// Ledger says more than the provider holds (negative drift).
	d2 := DetectDrift(2_000_000, 1_999_000)
	if !d2.Quarantine || d2.DiffKobo != -1000 {
		t.Errorf("negative drift wrong: %+v", d2)
	}
}
