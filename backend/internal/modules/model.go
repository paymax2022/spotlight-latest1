// Package modules is the platform module registry: which modules exist, and
// which of them each environment is allowed to show.
//
// It separates two questions that the FEATURE_*_ENABLED env vars conflate:
//
//	CAN this deployment run the module?   → the env flag (ops kill switch)
//	SHOULD this environment show it?      → this registry (admin decision)
//
// Effective visibility is the AND of both. The env flag is never overridden:
// publishing here can not resurrect a module ops has switched off.
package modules

import (
	"errors"
	"time"
)

// Environment is a deployment tier. Visibility is decided per environment, so a
// module can be live in development while still dark in production.
type Environment string

const (
	EnvDevelopment Environment = "development"
	EnvStaging     Environment = "staging"
	EnvProduction  Environment = "production"
)

// ValidEnvironment reports whether e is a known tier. Anything else is rejected
// rather than defaulted — silently treating an unknown environment as
// development would publish modules to a tier nobody chose.
func ValidEnvironment(e Environment) bool {
	switch e {
	case EnvDevelopment, EnvStaging, EnvProduction:
		return true
	}
	return false
}

// Status is a module's publication state within ONE environment.
type Status string

const (
	StatusHidden Status = "hidden"
	// StatusComingSoon renders the module but INERT — a teaser. The mobile ModuleCard
	// already drops onPress for a coming-soon tile, so this state only had to become
	// controllable per environment; the rendering predates it.
	StatusComingSoon Status = "coming_soon"
	StatusVisible    Status = "visible"
)

// Lifecycle is module-wide. Archiving hides a module in every environment while
// leaving its source in the tree — the point of the whole feature.
type Lifecycle string

const (
	LifecycleActive   Lifecycle = "active"
	LifecycleArchived Lifecycle = "archived"
)

// Action names a state transition. Recorded verbatim in the audit trail.
type Action string

const (
	ActionPublish Action = "publish"
	ActionHide    Action = "hide"
	ActionArchive Action = "archive"
	ActionRestore Action = "restore"
)

var (
	ErrModuleNotFound   = errors.New("modules: module not found")
	ErrInvalidEnv       = errors.New("modules: unknown environment")
	ErrInvalidStatus    = errors.New("modules: status must be 'hidden' or 'visible'")
	ErrInvalidLifecycle = errors.New("modules: lifecycle must be 'active' or 'archived'")
	// ErrArchivedModule is returned when someone tries to publish a module that is
	// archived. Restore is a deliberate, separately-audited step: an archived
	// module is one somebody decided to withdraw, and it should not come back as a
	// side effect of a routine publish click.
	ErrArchivedModule = errors.New("modules: cannot publish an archived module — restore it first")
)

// EnvironmentState is one (module, environment) publication row.
type EnvironmentState struct {
	Environment Environment `json:"environment"`
	Status      Status      `json:"status"`
	Note        string      `json:"note,omitempty"`
	UpdatedAt   time.Time   `json:"updated_at"`
	UpdatedBy   string      `json:"updated_by,omitempty"`
}

// Module is a registry entry plus its state in every environment.
type Module struct {
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	EnvFlag     string    `json:"env_flag,omitempty"`
	Description string    `json:"description,omitempty"`
	Lifecycle   Lifecycle `json:"lifecycle"`
	CreatedAt   time.Time `json:"created_at"`
	// Environments is keyed by Environment. A tier absent from the map has never
	// been decided and is treated as hidden.
	Environments map[Environment]EnvironmentState `json:"environments"`
	// EnvFlagEnabled reflects the ops kill switch in THIS process. It is reported
	// so the admin console can explain why a published module is still not
	// visible, instead of the operator concluding the toggle is broken.
	EnvFlagEnabled bool `json:"env_flag_enabled"`
}

// VisibleIn is the single visibility rule, in one place.
//
// Fail-closed on every axis: an archived module, an environment never decided,
// or an env flag that is off all yield false. Callers must not re-implement this
// — a second copy is how the client and server drift apart.
func (m Module) VisibleIn(env Environment) bool {
	if m.Lifecycle != LifecycleActive {
		return false
	}
	if !m.EnvFlagEnabled {
		return false
	}
	st, ok := m.Environments[env]
	if !ok {
		return false
	}
	return st.Status == StatusVisible
}

// ComingSoonIn reports whether the module should be RENDERED BUT INERT in env.
//
// It deliberately applies the same lifecycle and env-flag gates as VisibleIn: an
// archived module, or one whose environment flag is off, is not a teaser — it is simply
// absent. So the two are mutually exclusive, and a module is at most one of them.
func (m Module) ComingSoonIn(env Environment) bool {
	if m.Lifecycle != LifecycleActive {
		return false
	}
	if !m.EnvFlagEnabled {
		return false
	}
	st, ok := m.Environments[env]
	if !ok {
		return false
	}
	return st.Status == StatusComingSoon
}

// AssertPublishable guards the publish transition. Separated from the DB write so
// the rule is unit-testable without a database.
func (m Module) AssertPublishable() error {
	if m.Lifecycle == LifecycleArchived {
		return ErrArchivedModule
	}
	return nil
}

// ParseStatus validates a client-supplied status.
func ParseStatus(s string) (Status, error) {
	switch Status(s) {
	case StatusHidden:
		return StatusHidden, nil
	case StatusComingSoon:
		return StatusComingSoon, nil
	case StatusVisible:
		return StatusVisible, nil
	}
	return "", ErrInvalidStatus
}

// ParseLifecycle validates a client-supplied lifecycle.
func ParseLifecycle(s string) (Lifecycle, error) {
	switch Lifecycle(s) {
	case LifecycleActive:
		return LifecycleActive, nil
	case LifecycleArchived:
		return LifecycleArchived, nil
	}
	return "", ErrInvalidLifecycle
}

// ActionFor names the transition a status change represents, for the audit trail.
func ActionFor(s Status) Action {
	if s == StatusVisible {
		return ActionPublish
	}
	return ActionHide
}
