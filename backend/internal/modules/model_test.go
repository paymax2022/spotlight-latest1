package modules

import (
	"errors"
	"testing"
	"time"
)

// The registry decides what real users can see. Every test here is about it
// failing CLOSED: the dangerous direction is a module appearing in production
// that nobody published, so each axis is checked independently and in
// combination.

func mod(lc Lifecycle, flagOn bool, envs map[Environment]Status) Module {
	m := Module{
		Key: "telemedicine", Name: "Telemedicine", Lifecycle: lc,
		EnvFlagEnabled: flagOn, Environments: map[Environment]EnvironmentState{},
		CreatedAt: time.Now(),
	}
	for e, s := range envs {
		m.Environments[e] = EnvironmentState{Environment: e, Status: s}
	}
	return m
}

func TestVisibleIn_RequiresEveryAxis(t *testing.T) {
	cases := []struct {
		name string
		m    Module
		env  Environment
		want bool
	}{
		{"published, active, flag on → visible",
			mod(LifecycleActive, true, map[Environment]Status{EnvProduction: StatusVisible}), EnvProduction, true},

		// Each axis alone must be able to hide it.
		{"archived beats a published environment",
			mod(LifecycleArchived, true, map[Environment]Status{EnvProduction: StatusVisible}), EnvProduction, false},
		{"ops kill switch beats a published environment",
			mod(LifecycleActive, false, map[Environment]Status{EnvProduction: StatusVisible}), EnvProduction, false},
		{"explicitly hidden",
			mod(LifecycleActive, true, map[Environment]Status{EnvProduction: StatusHidden}), EnvProduction, false},

		// The one that matters most: a tier nobody has decided on.
		{"environment never decided → hidden, not defaulted on",
			mod(LifecycleActive, true, map[Environment]Status{EnvDevelopment: StatusVisible}), EnvProduction, false},

		// Publishing to development must not leak into production.
		{"visible in development only",
			mod(LifecycleActive, true, map[Environment]Status{EnvDevelopment: StatusVisible}), EnvDevelopment, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.m.VisibleIn(tc.env); got != tc.want {
				t.Fatalf("VisibleIn(%s) = %v, want %v — a wrong answer here shows or hides a module for every real user",
					tc.env, got, tc.want)
			}
		})
	}
}

// A module with no env flag recorded is gated only by the registry. Requiring a
// flag that does not exist would make such a module permanently invisible.
func TestVisibleIn_ModuleWithoutEnvFlag(t *testing.T) {
	m := mod(LifecycleActive, true, map[Environment]Status{EnvProduction: StatusVisible})
	m.EnvFlag = ""
	if !m.VisibleIn(EnvProduction) {
		t.Fatal("a module with no ops flag should be governed by the registry alone")
	}
}

// Publishing an archived module must be refused. Archive is a withdrawal
// decision; it should not be undone by a routine publish click.
func TestAssertPublishable(t *testing.T) {
	if err := mod(LifecycleActive, true, nil).AssertPublishable(); err != nil {
		t.Fatalf("active module must be publishable, got %v", err)
	}
	err := mod(LifecycleArchived, true, nil).AssertPublishable()
	if !errors.Is(err, ErrArchivedModule) {
		t.Fatalf("archived module must refuse publish with ErrArchivedModule, got %v", err)
	}
}

func TestParseStatus_RejectsAnythingElse(t *testing.T) {
	for _, ok := range []string{"hidden", "visible"} {
		if _, err := ParseStatus(ok); err != nil {
			t.Fatalf("ParseStatus(%q) errored: %v", ok, err)
		}
	}
	// An unrecognised status must not fall through to a default. "on"/"true"/""
	// silently meaning visible is how a typo publishes a module.
	for _, bad := range []string{"", "on", "true", "VISIBLE", "enabled", "published"} {
		if _, err := ParseStatus(bad); !errors.Is(err, ErrInvalidStatus) {
			t.Fatalf("ParseStatus(%q) should be rejected, got err=%v", bad, err)
		}
	}
}

func TestParseLifecycle_RejectsAnythingElse(t *testing.T) {
	for _, bad := range []string{"", "deleted", "ACTIVE", "disabled"} {
		if _, err := ParseLifecycle(bad); !errors.Is(err, ErrInvalidLifecycle) {
			t.Fatalf("ParseLifecycle(%q) should be rejected, got err=%v", bad, err)
		}
	}
}

func TestValidEnvironment(t *testing.T) {
	for _, ok := range []Environment{EnvDevelopment, EnvStaging, EnvProduction} {
		if !ValidEnvironment(ok) {
			t.Fatalf("%s should be valid", ok)
		}
	}
	// An unknown tier must be rejected, never coerced — coercion would apply a
	// publish decision to a tier the operator did not choose.
	for _, bad := range []Environment{"", "prod", "dev", "PRODUCTION", "local"} {
		if ValidEnvironment(bad) {
			t.Fatalf("%q should be rejected as an environment", bad)
		}
	}
}

// NewService must fail closed on misconfiguration, since both of these are
// "somebody forgot to wire it" cases and both would otherwise over-expose.
func TestNewService_FailsClosed(t *testing.T) {
	// Unrecognised APP_ENV → treated as production (the least-visible tier),
	// never development.
	if got := NewService(nil, Environment("banana"), nil).Env(); got != EnvProduction {
		t.Fatalf("unknown environment resolved to %s, want production", got)
	}
	// No flag lookup wired → every flag reads OFF.
	s := NewService(nil, EnvProduction, nil)
	if s.flag("FEATURE_ANYTHING") {
		t.Fatal("a missing flag lookup must read as OFF, not ON")
	}
}

func TestActionFor(t *testing.T) {
	if ActionFor(StatusVisible) != ActionPublish || ActionFor(StatusHidden) != ActionHide {
		t.Fatal("audit action must match the transition it records")
	}
}

// ─── coming_soon ─────────────────────────────────────────────────────────────

// TestParseStatusAcceptsComingSoon: the third state must round-trip, and near-misses
// must still be rejected rather than coerced — silently resolving a typo to 'hidden'
// would pull a live module off the grid.
func TestParseStatusAcceptsComingSoon(t *testing.T) {
	got, err := ParseStatus("coming_soon")
	if err != nil || got != StatusComingSoon {
		t.Fatalf("ParseStatus(coming_soon) = %v, %v; want coming_soon, nil", got, err)
	}
	for _, bad := range []string{"coming soon", "coming-soon", "comingSoon", "COMING_SOON", "soon", ""} {
		if _, err := ParseStatus(bad); err == nil {
			t.Errorf("ParseStatus(%q) was accepted; it must be rejected", bad)
		}
	}
}

// TestComingSoonAndVisibleAreMutuallyExclusive: a module has ONE status per
// environment, so no module may report both. Clients apply the two key lists
// independently and would otherwise need a precedence rule.
func TestComingSoonAndVisibleAreMutuallyExclusive(t *testing.T) {
	const env Environment = "production"
	for _, st := range []Status{StatusHidden, StatusComingSoon, StatusVisible} {
		m := Module{
			Key:            "demo",
			Lifecycle:      LifecycleActive,
			EnvFlagEnabled: true,
			Environments:   map[Environment]EnvironmentState{env: {Status: st}},
		}
		vis, soon := m.VisibleIn(env), m.ComingSoonIn(env)
		if vis && soon {
			t.Errorf("status %s reports both visible and coming-soon", st)
		}
		switch st {
		case StatusVisible:
			if !vis || soon {
				t.Errorf("status visible: VisibleIn=%v ComingSoonIn=%v, want true/false", vis, soon)
			}
		case StatusComingSoon:
			if vis || !soon {
				t.Errorf("status coming_soon: VisibleIn=%v ComingSoonIn=%v, want false/true", vis, soon)
			}
		case StatusHidden:
			if vis || soon {
				t.Errorf("status hidden: VisibleIn=%v ComingSoonIn=%v, want false/false", vis, soon)
			}
		}
	}
}

// TestComingSoonRespectsLifecycleAndFlag: an archived module, or one whose environment
// flag is off, is ABSENT — not a teaser. Otherwise archiving a module would leave a
// permanent dead tile on the grid.
func TestComingSoonRespectsLifecycleAndFlag(t *testing.T) {
	const env Environment = "production"
	base := func() Module {
		return Module{
			Key:            "demo",
			Lifecycle:      LifecycleActive,
			EnvFlagEnabled: true,
			Environments:   map[Environment]EnvironmentState{env: {Status: StatusComingSoon}},
		}
	}
	if !base().ComingSoonIn(env) {
		t.Fatal("baseline module should be coming-soon")
	}
	archived := base()
	archived.Lifecycle = LifecycleArchived
	if archived.ComingSoonIn(env) {
		t.Error("an archived module must not render as coming-soon")
	}
	flagOff := base()
	flagOff.EnvFlagEnabled = false
	if flagOff.ComingSoonIn(env) {
		t.Error("a module whose env flag is off must not render as coming-soon")
	}
	other := base()
	if other.ComingSoonIn("staging") {
		t.Error("coming-soon in production must not leak into staging")
	}
}
