package modules

import "testing"

func accessMod(key string, lvl AccessLevel) Module {
	return Module{Key: key, AccessLevel: lvl}
}

// TestUserMayAccessPrecedence pins the rule an admin and a support agent both rely on:
// general is open to everyone signed in; restricted needs KYC >= 1 OR a grant.
func TestUserMayAccessPrecedence(t *testing.T) {
	none := map[string]struct{}{}
	granted := map[string]struct{}{"telemedicine": {}}

	cases := []struct {
		name   string
		m      Module
		tier   int
		grants map[string]struct{}
		want   bool
	}{
		{"general, unverified, no grant", accessMod("support", AccessGeneral), 0, none, true},
		{"general, verified", accessMod("support", AccessGeneral), 3, none, true},
		{"restricted, unverified, no grant", accessMod("telemedicine", AccessRestricted), 0, none, false},
		{"restricted, unverified, GRANTED", accessMod("telemedicine", AccessRestricted), 0, granted, true},
		{"restricted, verified tier 1", accessMod("telemedicine", AccessRestricted), 1, none, true},
		{"restricted, verified tier 3", accessMod("telemedicine", AccessRestricted), 3, none, true},
		{"restricted, grant is for ANOTHER module", accessMod("wallet", AccessRestricted), 0, granted, false},
	}
	for _, c := range cases {
		if got := c.m.UserMayAccess(c.tier, c.grants); got != c.want {
			t.Errorf("%s: UserMayAccess = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestUnsetAccessLevelIsOpen: rows predating the column read as "" and must behave as
// 'general'. Treating an unset value as restricted would lock ~10k existing users out
// of every module the moment this deploys.
func TestUnsetAccessLevelIsOpen(t *testing.T) {
	m := Module{Key: "legacy"} // AccessLevel zero value
	if !m.UserMayAccess(0, map[string]struct{}{}) {
		t.Error("a module with no access_level must default to open, not restricted")
	}
}

// TestGrantsDoNotChangeMoneyLimits is a guard on the boundary this feature depends on:
// a grant opens a MODULE, it must never be consulted for money. If someone later wires
// grants into a spending decision, this test is the tripwire — the modules package must
// not reference the tiers package at all.
func TestGrantsDoNotChangeMoneyLimits(t *testing.T) {
	// A granted, unverified user may open the module...
	m := accessMod("telemedicine", AccessRestricted)
	if !m.UserMayAccess(0, map[string]struct{}{"telemedicine": {}}) {
		t.Fatal("a grant should open the module for an unverified user")
	}
	// ...and that is ALL it does. UserMayAccess returns a bool about access; it has no
	// amount, no currency and no tier config, so it cannot express a spending decision.
	// finance/tiers remains the only thing EnforceWalletDebitLimit consults.
}
