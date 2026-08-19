package modules

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FlagLookup answers "is this module's ops kill switch on in THIS process?".
// Injected so the registry does not import the config package and so tests can
// drive the flag axis without environment variables.
type FlagLookup func(envFlag string) bool

// Service reads and mutates the module registry.
type Service struct {
	db *pgxpool.Pool
	// env is the tier this process is running as. Reads for clients are always
	// scoped to it — a client can never ask "what is visible in production?" from
	// a staging deployment and get an answer that leaks an unpublished module.
	env  Environment
	flag FlagLookup
}

func NewService(db *pgxpool.Pool, env Environment, flag FlagLookup) *Service {
	if !ValidEnvironment(env) {
		// Fail closed: an unrecognised APP_ENV is treated as production, the tier
		// with the least visibility. Defaulting to development would publish every
		// module on a misconfigured deploy.
		env = EnvProduction
	}
	if flag == nil {
		// No lookup wired ⇒ every env flag reads as OFF, so nothing is visible.
		// A missing dependency must not silently grant visibility.
		flag = func(string) bool { return false }
	}
	return &Service{db: db, env: env, flag: flag}
}

// Env reports the tier this process serves.
func (s *Service) Env() Environment { return s.env }

const selectModules = `
	SELECT m.key, m.name, m.category, COALESCE(m.env_flag,''), COALESCE(m.description,''),
	       m.lifecycle, m.created_at,
	       COALESCE(e.environment,''), COALESCE(e.status,''), COALESCE(e.note,''),
	       e.updated_at, COALESCE(e.updated_by::text,'')
	  FROM public.platform_modules m
	  LEFT JOIN public.platform_module_environments e ON e.module_key = m.key
	 ORDER BY m.category, m.key`

// List returns every registered module with its state in every environment.
// Admin-facing: it deliberately exposes tiers other than this process's own.
func (s *Service) List(ctx context.Context) ([]Module, error) {
	rows, err := s.db.Query(ctx, selectModules)
	if err != nil {
		return nil, fmt.Errorf("modules: list: %w", err)
	}
	defer rows.Close()

	byKey := map[string]*Module{}
	var order []string
	for rows.Next() {
		var (
			key, name, category, envFlag, desc, lifecycle string
			createdAt                                     time.Time
			envName, status, note, updatedBy              string
			updatedAt                                     *time.Time
		)
		if err := rows.Scan(&key, &name, &category, &envFlag, &desc, &lifecycle, &createdAt,
			&envName, &status, &note, &updatedAt, &updatedBy); err != nil {
			return nil, fmt.Errorf("modules: scan: %w", err)
		}
		m, ok := byKey[key]
		if !ok {
			m = &Module{
				Key: key, Name: name, Category: category, EnvFlag: envFlag,
				Description: desc, Lifecycle: Lifecycle(lifecycle), CreatedAt: createdAt,
				Environments:   map[Environment]EnvironmentState{},
				EnvFlagEnabled: envFlag == "" || s.flag(envFlag),
			}
			byKey[key] = m
			order = append(order, key)
		}
		if envName != "" {
			st := EnvironmentState{
				Environment: Environment(envName), Status: Status(status),
				Note: note, UpdatedBy: updatedBy,
			}
			if updatedAt != nil {
				st.UpdatedAt = *updatedAt
			}
			m.Environments[Environment(envName)] = st
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("modules: rows: %w", err)
	}

	out := make([]Module, 0, len(order))
	for _, k := range order {
		out = append(out, *byKey[k])
	}
	return out, nil
}

// VisibleKeys returns the modules a client running in THIS environment may show.
// This is the endpoint the apps consume; it never reveals other tiers.
func (s *Service) VisibleKeys(ctx context.Context) ([]string, error) {
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(all))
	for _, m := range all {
		if m.VisibleIn(s.env) {
			keys = append(keys, m.Key)
		}
	}
	return keys, nil
}

// ComingSoonKeys returns the modules that should be RENDERED BUT INERT in this
// environment. Disjoint from VisibleKeys by construction (a module has one status per
// environment), so a client can apply them independently without ordering rules.
func (s *Service) ComingSoonKeys(ctx context.Context) ([]string, error) {
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(all))
	for _, m := range all {
		if m.ComingSoonIn(s.env) {
			keys = append(keys, m.Key)
		}
	}
	return keys, nil
}

// get loads one module (with all environments) or ErrModuleNotFound.
func (s *Service) get(ctx context.Context, key string) (Module, error) {
	all, err := s.List(ctx)
	if err != nil {
		return Module{}, err
	}
	for _, m := range all {
		if m.Key == key {
			return m, nil
		}
	}
	return Module{}, ErrModuleNotFound
}

// SetVisibility publishes or hides a module in one environment.
//
// Guarded transition: the module must exist, the environment must be known, and
// an archived module cannot be published. The state change and its audit row
// commit in ONE transaction, so there is no way to change what users see without
// a record of who did it.
//
// Idempotent: setting the status it already has re-writes the same value and
// records the no-op, rather than erroring on a double-click.
func (s *Service) SetVisibility(ctx context.Context, key string, env Environment, status Status, note, actorID string) (Module, error) {
	if !ValidEnvironment(env) {
		return Module{}, ErrInvalidEnv
	}
	m, err := s.get(ctx, key)
	if err != nil {
		return Module{}, err
	}
	if status == StatusVisible || status == StatusComingSoon {
		if err := m.AssertPublishable(); err != nil {
			return Module{}, err
		}
	}
	before := string(StatusHidden)
	if st, ok := m.Environments[env]; ok {
		before = string(st.Status)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Module{}, fmt.Errorf("modules: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := s.upsertEnv(ctx, tx, key, env, status, note, actorID); err != nil {
		return Module{}, err
	}
	if err := s.audit(ctx, tx, key, string(env), ActionFor(status), before, string(status), note, actorID); err != nil {
		return Module{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Module{}, fmt.Errorf("modules: commit: %w", err)
	}
	return s.get(ctx, key)
}

func (s *Service) upsertEnv(ctx context.Context, tx pgx.Tx, key string, env Environment, status Status, note, actorID string) error {
	const q = `
		INSERT INTO public.platform_module_environments (module_key, environment, status, note, updated_at, updated_by)
		VALUES ($1,$2,$3,NULLIF($4,''),now(),NULLIF($5,'')::uuid)
		ON CONFLICT (module_key, environment) DO UPDATE
		   SET status=$3, note=NULLIF($4,''), updated_at=now(), updated_by=NULLIF($5,'')::uuid`
	if _, err := tx.Exec(ctx, q, key, string(env), string(status), note, actorID); err != nil {
		return fmt.Errorf("modules: set visibility: %w", err)
	}
	return nil
}

// SetLifecycle archives or restores a module.
//
// Archiving does NOT clear per-environment rows. Restoring therefore returns the
// module to exactly the publication state it had before, instead of silently
// re-publishing it everywhere or dropping the operator's earlier decisions.
func (s *Service) SetLifecycle(ctx context.Context, key string, lc Lifecycle, note, actorID string) (Module, error) {
	m, err := s.get(ctx, key)
	if err != nil {
		return Module{}, err
	}
	action := ActionArchive
	if lc == LifecycleActive {
		action = ActionRestore
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Module{}, fmt.Errorf("modules: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`UPDATE public.platform_modules SET lifecycle=$2, updated_at=now() WHERE key=$1`,
		key, string(lc)); err != nil {
		return Module{}, fmt.Errorf("modules: set lifecycle: %w", err)
	}
	if err := s.audit(ctx, tx, key, "", action, string(m.Lifecycle), string(lc), note, actorID); err != nil {
		return Module{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Module{}, fmt.Errorf("modules: commit: %w", err)
	}
	return s.get(ctx, key)
}

// audit appends to the immutable trail. INSERT only — an entry is never updated,
// so "who hid this in production, and when" survives every later change.
func (s *Service) audit(ctx context.Context, tx pgx.Tx, key, env string, action Action, before, after, note, actorID string) error {
	const q = `
		INSERT INTO public.platform_module_audit
		    (module_key, environment, action, before_val, after_val, note, actor_id)
		VALUES ($1, NULLIF($2,''), $3, NULLIF($4,''), $5, NULLIF($6,''), NULLIF($7,'')::uuid)`
	if _, err := tx.Exec(ctx, q, key, env, string(action), before, after, note, actorID); err != nil {
		return fmt.Errorf("modules: audit: %w", err)
	}
	return nil
}

// AuditEntry is one recorded decision.
type AuditEntry struct {
	ModuleKey   string    `json:"module_key"`
	Environment string    `json:"environment,omitempty"`
	Action      Action    `json:"action"`
	Before      string    `json:"before,omitempty"`
	After       string    `json:"after"`
	Note        string    `json:"note,omitempty"`
	ActorID     string    `json:"actor_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// History returns the most recent decisions for one module.
func (s *Service) History(ctx context.Context, key string, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT module_key, COALESCE(environment,''), action, COALESCE(before_val,''),
		       after_val, COALESCE(note,''), COALESCE(actor_id::text,''), created_at
		  FROM public.platform_module_audit
		 WHERE module_key = $1
		 ORDER BY created_at DESC
		 LIMIT $2`
	rows, err := s.db.Query(ctx, q, key, limit)
	if err != nil {
		return nil, fmt.Errorf("modules: history: %w", err)
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ModuleKey, &e.Environment, &e.Action, &e.Before,
			&e.After, &e.Note, &e.ActorID, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("modules: history scan: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
