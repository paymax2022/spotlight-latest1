package nutrition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data layer for the NRE. It NEVER mutates money — there is
// no ledger here. Ownership is resolved via the restaurant module's chain
// (menu_items.restaurant_id → restaurants.owner_id → auth.users), replicated
// here for object-level authz. All status writes go through SetStatus (the
// guarded optimistic-version-locked update); raw status writes are not exposed.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the nutrition repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// sqlStater matches the pgx-wrapped *pgconn.PgError without importing pgconn.
type sqlStater interface{ SQLState() string }

// isCheckViolation reports a Postgres check_violation (SQLSTATE 23514) — the
// allergen safety CHECK constraints surface as this. Mapped to the clean
// ErrAllergenRuleViolation sentinel so a safety breach never leaks a raw error.
func isCheckViolation(err error) bool {
	var pgErr sqlStater
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23514"
	}
	return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership (replicates restaurant.assertOwner's join chain).
// ─────────────────────────────────────────────────────────────────────────────

// DishOwnership is the resolved (restaurant_id, owner_id, name) for a menu item.
type DishOwnership struct {
	MenuItemID   string
	RestaurantID string
	OwnerID      string
	Name         string
	Description  string
}

// DishInfo loads a dish's ownership context. Dishes have NO owner column —
// ownership = menu_items.restaurant_id → restaurants.owner_id. Returns
// ErrNotFound when the dish does not exist.
func (r *Repository) DishInfo(ctx context.Context, menuItemID string) (*DishOwnership, error) {
	var d DishOwnership
	const q = `
		SELECT mi.id, mi.restaurant_id, r.owner_id, mi.name, COALESCE(mi.description,'')
		FROM menu_items mi
		JOIN restaurants r ON r.id = mi.restaurant_id
		WHERE mi.id = $1`
	if err := r.db.QueryRow(ctx, q, menuItemID).Scan(
		&d.MenuItemID, &d.RestaurantID, &d.OwnerID, &d.Name, &d.Description); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &d, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition reference.
// ─────────────────────────────────────────────────────────────────────────────

const compCols = `id, food_code, name, source, prep_method,
	COALESCE(energy_kcal,0), COALESCE(protein_g,0), COALESCE(carb_g,0), COALESCE(sugar_g,0),
	COALESCE(fat_g,0), COALESCE(sat_fat_g,0), COALESCE(fiber_g,0), COALESCE(sodium_mg,0), version`

func scanComposition(row interface{ Scan(...any) error }) (*Composition, error) {
	var c Composition
	if err := row.Scan(&c.ID, &c.FoodCode, &c.Name, &c.Source, &c.PrepMethod,
		&c.EnergyKcal, &c.ProteinG, &c.CarbG, &c.SugarG, &c.FatG, &c.SatFatG,
		&c.FiberG, &c.SodiumMg, &c.Version); err != nil {
		return nil, err
	}
	return &c, nil
}

// LookupComposition resolves the latest-version reference for an ingredient.
// Prefers an exact (food_code, source, prep_method) match; falls back to the
// highest version of the food_code regardless of prep. Returns (nil, nil) on
// a clean miss.
func (r *Repository) LookupComposition(ctx context.Context, foodCode, source, prep string) (*Composition, error) {
	// Exact match on code+source+prep, newest version first.
	const q1 = `SELECT ` + compCols + ` FROM composition_reference
		WHERE food_code=$1 AND ($2='' OR source=$2) AND ($3='' OR prep_method=$3)
		ORDER BY version DESC LIMIT 1`
	row := r.db.QueryRow(ctx, q1, foodCode, source, prep)
	c, err := scanComposition(row)
	if err == nil {
		return c, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	// Fall back to any prep for this food_code, newest version.
	const q2 = `SELECT ` + compCols + ` FROM composition_reference
		WHERE food_code=$1 ORDER BY version DESC LIMIT 1`
	c, err = scanComposition(r.db.QueryRow(ctx, q2, foodCode))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return c, nil
}

// UpsertComposition inserts a NEW versioned reference row (admin). It never
// mutates an existing row in place — a new version is appended (additive), so the
// UNIQUE(food_code, source, prep_method, version) is respected.
func (r *Repository) UpsertComposition(ctx context.Context, c Composition) (*Composition, error) {
	// Next version = max existing for (code,source,prep) + 1.
	var maxV int
	_ = r.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(version),0) FROM composition_reference
		 WHERE food_code=$1 AND source=$2 AND prep_method=$3`,
		c.FoodCode, c.Source, c.PrepMethod).Scan(&maxV)
	c.Version = maxV + 1
	const ins = `INSERT INTO composition_reference
		(id, food_code, name, source, prep_method, energy_kcal, protein_g, carb_g, sugar_g,
		 fat_g, sat_fat_g, fiber_g, sodium_mg, version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING ` + compCols
	row := r.db.QueryRow(ctx, ins, uuid.New().String(), c.FoodCode, c.Name, c.Source, c.PrepMethod,
		c.EnergyKcal, c.ProteinG, c.CarbG, c.SugarG, c.FatG, c.SatFatG, c.FiberG, c.SodiumMg, c.Version)
	return scanComposition(row)
}

// ─────────────────────────────────────────────────────────────────────────────
// Dish library (Tier 2).
// ─────────────────────────────────────────────────────────────────────────────

// AllLibraryEntries loads the curated library for in-memory fuzzy matching.
func (r *Repository) AllLibraryEntries(ctx context.Context) ([]LibraryEntry, error) {
	const q = `SELECT id, slug, name, aliases, standard_portion_g, COALESCE(cook_method,''),
		per_serving, composition_version FROM nutrition_dish_library`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LibraryEntry
	for rows.Next() {
		var e LibraryEntry
		var psRaw []byte
		if err := rows.Scan(&e.ID, &e.Slug, &e.Name, &e.Aliases, &e.StandardPortionG,
			&e.CookMethod, &psRaw, &e.CompositionVersion); err != nil {
			return nil, err
		}
		if len(psRaw) > 0 {
			_ = json.Unmarshal(psRaw, &e.PerServing)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// UpsertLibrary curates a library entry (admin). Idempotent on slug.
func (r *Repository) UpsertLibrary(ctx context.Context, e LibraryEntry) error {
	psJSON, _ := json.Marshal(orPerServing(e.PerServing))
	const q = `INSERT INTO nutrition_dish_library
		(id, slug, name, aliases, standard_portion_g, cook_method, per_serving, composition_version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (slug) DO UPDATE SET
			name=EXCLUDED.name, aliases=EXCLUDED.aliases, standard_portion_g=EXCLUDED.standard_portion_g,
			cook_method=EXCLUDED.cook_method, per_serving=EXCLUDED.per_serving,
			composition_version=EXCLUDED.composition_version, version=nutrition_dish_library.version+1`
	_, err := r.db.Exec(ctx, q, uuid.New().String(), e.Slug, e.Name, strArray(e.Aliases),
		e.StandardPortionG, e.CookMethod, psJSON, e.CompositionVersion)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe (Tier 1, vendor-owned).
// ─────────────────────────────────────────────────────────────────────────────

// GetRecipe loads the recipe for a dish, or (nil, nil) when none exists.
func (r *Repository) GetRecipe(ctx context.Context, menuItemID string) (*Recipe, error) {
	const q = `SELECT id, menu_item_id, restaurant_id, ingredients, portion_size_g,
		COALESCE(cook_method,''), version FROM dish_recipe WHERE menu_item_id=$1`
	var rec Recipe
	var ingRaw []byte
	err := r.db.QueryRow(ctx, q, menuItemID).Scan(&rec.ID, &rec.MenuItemID, &rec.RestaurantID,
		&ingRaw, &rec.PortionSizeG, &rec.CookMethod, &rec.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if len(ingRaw) > 0 {
		_ = json.Unmarshal(ingRaw, &rec.Ingredients)
	}
	return &rec, nil
}

// UpsertRecipe declares/updates a dish recipe (vendor). Idempotent on the unique
// menu_item_id. Returns the persisted recipe.
func (r *Repository) UpsertRecipe(ctx context.Context, rec Recipe) (*Recipe, error) {
	ingJSON, _ := json.Marshal(orIngredients(rec.Ingredients))
	const q = `INSERT INTO dish_recipe
		(id, menu_item_id, restaurant_id, ingredients, portion_size_g, cook_method)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (menu_item_id) DO UPDATE SET
			ingredients=EXCLUDED.ingredients, portion_size_g=EXCLUDED.portion_size_g,
			cook_method=EXCLUDED.cook_method, version=dish_recipe.version+1
		RETURNING id, menu_item_id, restaurant_id, ingredients, portion_size_g, COALESCE(cook_method,''), version`
	var out Recipe
	var ingRaw []byte
	if err := r.db.QueryRow(ctx, q, uuid.New().String(), rec.MenuItemID, rec.RestaurantID,
		ingJSON, rec.PortionSizeG, rec.CookMethod).Scan(&out.ID, &out.MenuItemID, &out.RestaurantID,
		&ingRaw, &out.PortionSizeG, &out.CookMethod, &out.Version); err != nil {
		return nil, err
	}
	if len(ingRaw) > 0 {
		_ = json.Unmarshal(ingRaw, &out.Ingredients)
	}
	return &out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile (the resolved output; optimistic-version-locked status machine).
// ─────────────────────────────────────────────────────────────────────────────

const profileCols = `id, menu_item_id, restaurant_id, grounding, confidence, status,
	portion_label, portion_size_g, per_serving, composition_version, confirmed_by::text, version`

func scanProfile(row interface{ Scan(...any) error }) (*Profile, error) {
	var p Profile
	var psRaw []byte
	var grounding, conf, status string
	if err := row.Scan(&p.ID, &p.MenuItemID, &p.RestaurantID, &grounding, &conf, &status,
		&p.PortionLabel, &p.PortionSizeG, &psRaw, &p.CompositionVersion, &p.ConfirmedBy, &p.Version); err != nil {
		return nil, err
	}
	p.Grounding = Grounding(grounding)
	p.Confidence = Confidence(conf)
	p.Status = Status(status)
	if len(psRaw) > 0 {
		_ = json.Unmarshal(psRaw, &p.PerServing)
	}
	return &p, nil
}

// GetProfile loads the profile for a dish, or (nil, nil) when none exists yet.
func (r *Repository) GetProfile(ctx context.Context, menuItemID string) (*Profile, error) {
	row := r.db.QueryRow(ctx, `SELECT `+profileCols+` FROM dish_nutrition_profile WHERE menu_item_id=$1`, menuItemID)
	p, err := scanProfile(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return p, nil
}

// UpsertResolved writes a freshly resolved profile. On first resolve it inserts;
// on a subsequent resolve it updates the resolved fields and bumps the optimistic
// version. The caller (service) is responsible for the supersede decision + the
// status-machine guard; this method just persists. expectedVersion is the
// optimistic lock for the UPDATE path (ignored on INSERT).
func (r *Repository) UpsertResolved(ctx context.Context, p Profile, expectedVersion int) (*Profile, error) {
	psJSON, _ := json.Marshal(orPerServing(p.PerServing))
	portionLabel := p.PortionLabel
	if portionLabel == "" {
		portionLabel = "regular"
	}
	// INSERT … ON CONFLICT (menu_item_id) with an optimistic guard on version.
	const q = `
		INSERT INTO dish_nutrition_profile
			(id, menu_item_id, restaurant_id, grounding, confidence, status, portion_label,
			 portion_size_g, per_serving, composition_version, resolved_at, version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), 0)
		ON CONFLICT (menu_item_id) DO UPDATE SET
			grounding=EXCLUDED.grounding, confidence=EXCLUDED.confidence,
			status=EXCLUDED.status, portion_label=EXCLUDED.portion_label,
			portion_size_g=EXCLUDED.portion_size_g,
			per_serving=EXCLUDED.per_serving, composition_version=EXCLUDED.composition_version,
			resolved_at=now(), version=dish_nutrition_profile.version + 1
		WHERE dish_nutrition_profile.version = $11
		RETURNING ` + profileCols
	row := r.db.QueryRow(ctx, q, uuid.New().String(), p.MenuItemID, p.RestaurantID,
		string(p.Grounding), string(p.Confidence), string(p.Status), portionLabel, p.PortionSizeG,
		psJSON, p.CompositionVersion, expectedVersion)
	out, err := scanProfile(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 0 rows: the ON CONFLICT update's WHERE version guard failed → a
			// concurrent writer raced us.
			return nil, ErrVersionConflict
		}
		return nil, err
	}
	return out, nil
}

// SetStatus applies a GUARDED optimistic-version-locked status change. The
// caller MUST have validated CanTransition first; this enforces the version lock.
// A 0-row update means a concurrent writer raced (ErrVersionConflict).
func (r *Repository) SetStatus(ctx context.Context, menuItemID string, to Status, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE dish_nutrition_profile
		SET status=$2, version=version+1, updated_at=now()
		WHERE menu_item_id=$1 AND version=$3`, menuItemID, string(to), expectedVersion)
	if err != nil {
		return fmt.Errorf("nutrition: set status: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrVersionConflict
	}
	return nil
}

// Approve marks an AI_ESTIMATE profile RESTAURANT_CONFIRMED (vendor approval of
// the estimate — still an estimate). Optimistic-version-locked; stamps
// confirmed_by/at.
func (r *Repository) Approve(ctx context.Context, menuItemID, vendorUserID string, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE dish_nutrition_profile
		SET status='RESTAURANT_CONFIRMED', confirmed_by=$2, confirmed_at=now(),
		    version=version+1, updated_at=now()
		WHERE menu_item_id=$1 AND version=$3`, menuItemID, vendorUserID, expectedVersion)
	if err != nil {
		return fmt.Errorf("nutrition: approve: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrVersionConflict
	}
	return nil
}

// SetConfirmedBy stamps confirmed_by/at without changing status (used after a
// recipe declaration, whose UpsertResolved already set RESTAURANT_CONFIRMED).
// Best-effort; not version-locked.
func (r *Repository) SetConfirmedBy(ctx context.Context, menuItemID, vendorUserID string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE dish_nutrition_profile
		SET confirmed_by=$2, confirmed_at=now(), updated_at=now()
		WHERE menu_item_id=$1`, menuItemID, vendorUserID)
	return err
}

// UpdateEdited applies a lightweight vendor edit (portion rescale + macro nudge),
// flips the status to RESTAURANT_CONFIRMED (an edit is an implicit approval), and
// stamps confirmed_by/at. Optimistic-version-locked. Returns the updated profile.
func (r *Repository) UpdateEdited(ctx context.Context, menuItemID, vendorUserID, portionLabel string, portionG float64, ps PerServing, expectedVersion int) (*Profile, error) {
	psJSON, _ := json.Marshal(orPerServing(ps))
	const q = `
		UPDATE dish_nutrition_profile
		SET status='RESTAURANT_CONFIRMED', portion_label=$2, portion_size_g=$3,
		    per_serving=$4, confirmed_by=$5, confirmed_at=now(),
		    version=version+1, updated_at=now()
		WHERE menu_item_id=$1 AND version=$6
		RETURNING ` + profileCols
	row := r.db.QueryRow(ctx, q, menuItemID, portionLabel, portionG, psJSON, vendorUserID, expectedVersion)
	out, err := scanProfile(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, err
	}
	return out, nil
}

// RestaurantOwner returns the owner_id for a restaurant (object-level authz for
// batch menu actions). Returns ErrNotFound when the restaurant does not exist.
func (r *Repository) RestaurantOwner(ctx context.Context, restaurantID string) (string, error) {
	var owner string
	err := r.db.QueryRow(ctx, `SELECT owner_id::text FROM restaurants WHERE id=$1`, restaurantID).Scan(&owner)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return owner, nil
}

// MenuItem is a restaurant menu item that still needs a profile (auto-suggest).
type MenuItem struct {
	MenuItemID string
	Name       string
}

// MenuItemsNeedingProfile returns the restaurant's menu items that have NO profile
// yet OR whose profile is STALE (left join dish_nutrition_profile). These are the
// dishes auto-suggest estimates + auto-publishes.
func (r *Repository) MenuItemsNeedingProfile(ctx context.Context, restaurantID string) ([]MenuItem, error) {
	const q = `
		SELECT mi.id, mi.name
		FROM menu_items mi
		LEFT JOIN dish_nutrition_profile p ON p.menu_item_id = mi.id
		WHERE mi.restaurant_id = $1
		  AND (p.id IS NULL OR p.status = 'STALE')`
	rows, err := r.db.Query(ctx, q, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MenuItem
	for rows.Next() {
		var m MenuItem
		if err := rows.Scan(&m.MenuItemID, &m.Name); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertLibraryFeedback records a vendor-edited/approved library-matched dish for
// the learn-from-edits loop (best-effort; the caller ignores the error).
func (r *Repository) InsertLibraryFeedback(ctx context.Context, slug, menuItemID, restaurantID string, portionG float64, ps PerServing) error {
	psJSON, _ := json.Marshal(orPerServing(ps))
	const q = `INSERT INTO nutrition_library_feedback
		(id, library_slug, menu_item_id, restaurant_id, portion_size_g, per_serving)
		VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, uuid.New().String(), slug, nilUUID(menuItemID), nilUUID(restaurantID), portionG, psJSON)
	return err
}

// ListByRestaurant returns profiles for a restaurant (used by re-resolve batch).
func (r *Repository) ListByRestaurant(ctx context.Context, restaurantID string) ([]Profile, error) {
	rows, err := r.db.Query(ctx, `SELECT `+profileCols+` FROM dish_nutrition_profile WHERE restaurant_id=$1`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Profile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ListAllProfiles returns every profile (admin batch re-resolve on version bump).
func (r *Repository) ListAllProfiles(ctx context.Context, limit int) ([]Profile, error) {
	if limit <= 0 || limit > 2000 {
		limit = 1000
	}
	rows, err := r.db.Query(ctx, `SELECT `+profileCols+` FROM dish_nutrition_profile ORDER BY updated_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Profile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────────────
// Allergens (SAFETY-CRITICAL).
// ─────────────────────────────────────────────────────────────────────────────

// ListAllergens returns all allergen declarations for a dish (buyer-readable).
func (r *Repository) ListAllergens(ctx context.Context, menuItemID string) ([]AllergenDeclaration, error) {
	const q = `SELECT id, menu_item_id, restaurant_id, allergen, declaration_type, source,
		attested_by::text, cross_contamination_ack
		FROM allergen_declaration WHERE menu_item_id=$1 ORDER BY allergen`
	rows, err := r.db.Query(ctx, q, menuItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AllergenDeclaration
	for rows.Next() {
		var a AllergenDeclaration
		if err := rows.Scan(&a.ID, &a.MenuItemID, &a.RestaurantID, &a.Allergen,
			&a.DeclarationType, &a.Source, &a.AttestedBy, &a.CrossContamAck); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// UpsertAllergen inserts/updates an allergen declaration. The DB CHECK
// constraints are the structural enforcement of the safety rules; a violation
// surfaces as SQLSTATE 23514 and is mapped to the clean ErrAllergenRuleViolation
// sentinel here (so no raw DB error leaks). The service ALSO validates in code
// (validateAllergen) before calling this — defense in depth.
func (r *Repository) UpsertAllergen(ctx context.Context, a AllergenDeclaration) error {
	// Bind attested_by/at only for VENDOR-sourced definitive claims.
	var attestedBy any
	if a.AttestedBy != nil && *a.AttestedBy != "" {
		attestedBy = *a.AttestedBy
	}
	const q = `INSERT INTO allergen_declaration
		(id, menu_item_id, restaurant_id, allergen, declaration_type, source,
		 attested_by, attested_at, cross_contamination_ack)
		VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $7 IS NULL THEN NULL ELSE now() END, $8)
		ON CONFLICT (menu_item_id, allergen, source) DO UPDATE SET
			declaration_type=EXCLUDED.declaration_type,
			attested_by=EXCLUDED.attested_by, attested_at=EXCLUDED.attested_at,
			cross_contamination_ack=EXCLUDED.cross_contamination_ack, updated_at=now()`
	_, err := r.db.Exec(ctx, q, uuid.New().String(), a.MenuItemID, a.RestaurantID, a.Allergen,
		a.DeclarationType, a.Source, attestedBy, a.CrossContamAck)
	if err != nil {
		if isCheckViolation(err) {
			return ErrAllergenRuleViolation
		}
		return err
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit (immutable, INSERT-only — AI estimates + vendor confirmations +
// allergen attestations).
// ─────────────────────────────────────────────────────────────────────────────

// Audit appends an immutable audit row. actorID may be empty (system/AI → NULL).
func (r *Repository) Audit(ctx context.Context, menuItemID, actorID, action string, before, after, metadata map[string]any) error {
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	metaJSON, _ := json.Marshal(orMeta(metadata))
	const ins = `INSERT INTO nutrition_audit_log
		(id, menu_item_id, actor_id, action, before, after, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := r.db.Exec(ctx, ins, uuid.New().String(), nilUUID(menuItemID), nilUUID(actorID),
		action, beforeJSON, afterJSON, metaJSON)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// small helpers
// ─────────────────────────────────────────────────────────────────────────────

func nilUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func orPerServing(p PerServing) PerServing {
	if p == nil {
		return PerServing{}
	}
	return p
}

func orIngredients(in []Ingredient) []Ingredient {
	if in == nil {
		return []Ingredient{}
	}
	return in
}

func orMeta(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// strArray nil-guards a Go slice so a NULL never reaches a TEXT[] column.
func strArray(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}
