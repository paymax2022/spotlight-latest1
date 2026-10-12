package cryptosvc

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/transfers"
)

func okWire() (WireConfig, WireDeps) {
	return WireConfig{Provider: "quidax", QuidaxKey: "k", WebhookSecret: "w", DatabaseURL: "postgres://x", Fees: DefaultFeeSchedule()},
		WireDeps{Pool: &pgxpool.Pool{}, Ledger: &ledger.Service{}, Tiers: &tiers.Service{}, Transfers: &transfers.Service{}}
}

func TestWireFailsClosedOnAnyMissingPiece(t *testing.T) {
	for name, mutate := range map[string]func(*WireConfig, *WireDeps){
		"mock provider":     func(c *WireConfig, _ *WireDeps) { c.Provider = "mock" },
		"empty provider":    func(c *WireConfig, _ *WireDeps) { c.Provider = "" },
		"no key":            func(c *WireConfig, _ *WireDeps) { c.QuidaxKey = " " },
		"no webhook secret": func(c *WireConfig, _ *WireDeps) { c.WebhookSecret = "" },
		"no database url":   func(c *WireConfig, _ *WireDeps) { c.DatabaseURL = "" },
		"no pool":           func(_ *WireConfig, d *WireDeps) { d.Pool = nil },
		"no ledger":         func(_ *WireConfig, d *WireDeps) { d.Ledger = nil },
		"no tiers":          func(_ *WireConfig, d *WireDeps) { d.Tiers = nil },
		"no transfers":      func(_ *WireConfig, d *WireDeps) { d.Transfers = nil },
		"bad fee schedule":  func(c *WireConfig, _ *WireDeps) { c.Fees.OtherBps = 9999 },
	} {
		c, d := okWire()
		mutate(&c, &d)
		w, err := Wire(context.Background(), c, d)
		if err == nil || w != nil {
			t.Errorf("%s: Wire succeeded", name)
		}
	}
}

func TestWireErrorsNeverContainSecrets(t *testing.T) {
	c, d := okWire()
	c.QuidaxKey = "sk_super_secret_value"
	c.WebhookSecret = ""
	_, err := Wire(context.Background(), c, d)
	if err == nil || strings.Contains(err.Error(), "sk_super_secret_value") {
		t.Fatalf("err = %v", err)
	}
}

func TestTransfersStepUpNeverScoresAnEmptyPin(t *testing.T) {
	s := &TransfersStepUp{Svc: nil} // must not even touch the service for an empty PIN
	if err := s.VerifyPin(context.Background(), "u", "  "); err != ErrStepUpRejected {
		t.Fatalf("err = %v", err)
	}
}
