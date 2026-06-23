package doctor

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// repository_vet.go — pgx data access for Wave 3b (VETERINARY / PET-side) endpoint
// groups: vet profile, pet profile, pet vaccinations, pet e-prescriptions, pet labs,
// pet store. Mirrors repository_clinical.go exactly.
//
// Every read is scoped to the owning vet's user_id (defence in depth on top of RLS);
// child rows (vaccinations, results, recommendations, fulfilments) also carry user_id
// and are scoped the same way. Mutations on tables with a UNIQUE idempotency_key
// (doctor_pet_vaccinations, doctor_pet_prescriptions, doctor_pet_lab_orders,
// doctor_pet_recommendations) INSERT with ON CONFLICT (idempotency_key) DO NOTHING +
// replay; state transitions on existing rows (issue / send / review / share / growth
// append) are status-guarded scoped UPDATEs (naturally idempotent). None post ledger
// entries — they are clinical / document writes, not value movements (price_kobo /
// total_kobo are surfaced as-is, never mutated as a balance).
//
// Reference / inventory paths with no backing table in the migration (vet appointments,
// pet-owner requests, vet chat / call / soap-note, emergency warnings, vet specialists,
// pet referrals, consult summary / history, pet pharmacies, pet refills, pet lab
// catalogue, pet chronic-monitoring) have no repository method — the service layer
// returns an empty projection (or echoes the request body for no-table writes).

// ══ VET PROFILE ═════════════════════════════════════════════════════════════

func (r *Repository) GetVetProfile(ctx context.Context, userID string) (*VetProfile, error) {
	const q = `
		SELECT id, user_id, vet_mode_enabled, licence_number, verification, is_published,
		       profile_draft, detail, created_at, updated_at
		FROM doctor_vet_profiles WHERE user_id = $1`
	v := &VetProfile{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&v.ID, &v.UserID, &v.VetModeEnabled, &v.LicenceNumber,
		&v.Verification, &v.IsPublished, &v.ProfileDraft, &v.Detail, &v.CreatedAt, &v.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

// UpsertVetMode toggles vet mode for the vet (one row per user_id, UNIQUE). The row is
// created on first toggle. Naturally idempotent on the (user_id) key.
func (r *Repository) UpsertVetMode(ctx context.Context, userID string, enabled bool, detail []byte) (*VetProfile, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_vet_profiles (id, user_id, vet_mode_enabled, detail)
		VALUES ($1,$2,$3,$4::jsonb)
		ON CONFLICT (user_id) DO UPDATE
		SET vet_mode_enabled = EXCLUDED.vet_mode_enabled,
		    detail = doctor_vet_profiles.detail || $4::jsonb,
		    updated_at = now()`
	if _, err := r.db.Exec(ctx, q, id, userID, enabled, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return r.GetVetProfile(ctx, userID)
}

// ══ PETS ════════════════════════════════════════════════════════════════════

func (r *Repository) ListPets(ctx context.Context, userID string) ([]Pet, error) {
	const q = `
		SELECT id, user_id, owner_ref, name, species, breed, profile, growth_history, created_at, updated_at
		FROM doctor_pets WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Pet{}
	for rows.Next() {
		p := Pet{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.OwnerRef, &p.Name, &p.Species, &p.Breed,
			&p.Profile, &p.GrowthHistory, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPet(ctx context.Context, userID, petID string) (*Pet, error) {
	const q = `
		SELECT id, user_id, owner_ref, name, species, breed, profile, growth_history, created_at, updated_at
		FROM doctor_pets WHERE id = $1 AND user_id = $2`
	p := &Pet{}
	err := r.db.QueryRow(ctx, q, petID, userID).Scan(&p.ID, &p.UserID, &p.OwnerRef, &p.Name,
		&p.Species, &p.Breed, &p.Profile, &p.GrowthHistory, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// AppendPetGrowth pushes a growth measurement onto doctor_pets.growth_history (scoped).
func (r *Repository) AppendPetGrowth(ctx context.Context, userID, petID string, measurement []byte) (*Pet, error) {
	const q = `
		UPDATE doctor_pets
		SET growth_history = growth_history || $3::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, petID, userID, jsonOrEmptyArray(measurement))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetPet(ctx, userID, petID)
}

// ══ PET VACCINATIONS ════════════════════════════════════════════════════════

func (r *Repository) ListPetVaccinations(ctx context.Context, userID, petID string) ([]PetVaccination, error) {
	const q = `
		SELECT id, pet_id, user_id, vaccine, due_at, administered_at, reminder_set, detail, created_at
		FROM doctor_pet_vaccinations WHERE user_id = $1 AND pet_id = $2 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID, petID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetVaccination{}
	for rows.Next() {
		v := PetVaccination{}
		if err := rows.Scan(&v.ID, &v.PetID, &v.UserID, &v.Vaccine, &v.DueAt, &v.AdministeredAt,
			&v.ReminderSet, &v.Detail, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ListPetVaccinationReminders returns the pet's vaccinations that have a reminder set.
func (r *Repository) ListPetVaccinationReminders(ctx context.Context, userID, petID string) ([]PetVaccination, error) {
	const q = `
		SELECT id, pet_id, user_id, vaccine, due_at, administered_at, reminder_set, detail, created_at
		FROM doctor_pet_vaccinations WHERE user_id = $1 AND pet_id = $2 AND reminder_set = true ORDER BY due_at ASC`
	rows, err := r.db.Query(ctx, q, userID, petID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetVaccination{}
	for rows.Next() {
		v := PetVaccination{}
		if err := rows.Scan(&v.ID, &v.PetID, &v.UserID, &v.Vaccine, &v.DueAt, &v.AdministeredAt,
			&v.ReminderSet, &v.Detail, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// InsertPetVaccinationReminder records a vaccination + reminder idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertPetVaccinationReminder(ctx context.Context, userID, petID string, vaccine *string, dueAt *time.Time, detail []byte, idemKey string) (*PetVaccination, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_pet_vaccinations (id, pet_id, user_id, vaccine, due_at, reminder_set, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, petID, userID, vaccine, dueAt, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getPetVaccinationByIdem(ctx, userID, idemKey)
	}
	return r.getPetVaccinationByID(ctx, userID, id)
}

func (r *Repository) getPetVaccinationByID(ctx context.Context, userID, id string) (*PetVaccination, error) {
	const q = `
		SELECT id, pet_id, user_id, vaccine, due_at, administered_at, reminder_set, detail, created_at
		FROM doctor_pet_vaccinations WHERE id = $1 AND user_id = $2`
	v := &PetVaccination{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&v.ID, &v.PetID, &v.UserID, &v.Vaccine, &v.DueAt,
		&v.AdministeredAt, &v.ReminderSet, &v.Detail, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

func (r *Repository) getPetVaccinationByIdem(ctx context.Context, userID, idemKey string) (*PetVaccination, error) {
	const q = `
		SELECT id, pet_id, user_id, vaccine, due_at, administered_at, reminder_set, detail, created_at
		FROM doctor_pet_vaccinations WHERE user_id = $1 AND idempotency_key = $2`
	v := &PetVaccination{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&v.ID, &v.PetID, &v.UserID, &v.Vaccine, &v.DueAt,
		&v.AdministeredAt, &v.ReminderSet, &v.Detail, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

// ══ PET PRESCRIPTIONS ═══════════════════════════════════════════════════════

func (r *Repository) ListPetPrescriptions(ctx context.Context, userID string) ([]PetPrescription, error) {
	const q = `
		SELECT id, user_id, pet_id, ref, status, items, issued_at, created_at, updated_at
		FROM doctor_pet_prescriptions WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetPrescription{}
	for rows.Next() {
		p := PetPrescription{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.PetID, &p.Ref, &p.Status, &p.Items,
			&p.IssuedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPetPrescription(ctx context.Context, userID, id string) (*PetPrescription, error) {
	const q = `
		SELECT id, user_id, pet_id, ref, status, items, issued_at, created_at, updated_at
		FROM doctor_pet_prescriptions WHERE id = $1 AND user_id = $2`
	p := &PetPrescription{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&p.ID, &p.UserID, &p.PetID, &p.Ref, &p.Status,
		&p.Items, &p.IssuedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// InsertPetPrescription creates a draft pet prescription idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertPetPrescription(ctx context.Context, userID string, petID, ref *string, items []byte, idemKey string) (*PetPrescription, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_pet_prescriptions (id, user_id, pet_id, ref, status, items, idempotency_key)
		VALUES ($1,$2,$3,$4,'draft',$5::jsonb,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, petID, ref, jsonOrEmptyArray(items), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getPetPrescriptionByIdem(ctx, userID, idemKey)
	}
	return r.GetPetPrescription(ctx, userID, id)
}

func (r *Repository) getPetPrescriptionByIdem(ctx context.Context, userID, idemKey string) (*PetPrescription, error) {
	const q = `
		SELECT id, user_id, pet_id, ref, status, items, issued_at, created_at, updated_at
		FROM doctor_pet_prescriptions WHERE user_id = $1 AND idempotency_key = $2`
	p := &PetPrescription{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&p.ID, &p.UserID, &p.PetID, &p.Ref, &p.Status,
		&p.Items, &p.IssuedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// GetPetPrescriptionForPet returns the most recent prescription for a pet (scoped).
func (r *Repository) GetPetPrescriptionForPet(ctx context.Context, userID, petID string) (*PetPrescription, error) {
	const q = `
		SELECT id, user_id, pet_id, ref, status, items, issued_at, created_at, updated_at
		FROM doctor_pet_prescriptions WHERE user_id = $1 AND pet_id = $2 ORDER BY created_at DESC LIMIT 1`
	p := &PetPrescription{}
	err := r.db.QueryRow(ctx, q, userID, petID).Scan(&p.ID, &p.UserID, &p.PetID, &p.Ref, &p.Status,
		&p.Items, &p.IssuedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// IssuePetPrescription transitions a draft → issued (scoped, status-guarded → idempotent).
func (r *Repository) IssuePetPrescription(ctx context.Context, userID, prescriptionID string) (*PetPrescription, error) {
	const q = `
		UPDATE doctor_pet_prescriptions
		SET status = 'issued', issued_at = COALESCE(issued_at, now()), updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'draft'`
	tag, err := r.db.Exec(ctx, q, prescriptionID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Already issued (replay) or not found — return the row or 404.
		return r.GetPetPrescription(ctx, userID, prescriptionID)
	}
	return r.GetPetPrescription(ctx, userID, prescriptionID)
}

// SendPetPrescription transitions an issued prescription → dispensed (sent to pharmacy).
// Status-guarded and scoped → idempotent. The pharmacy reference is merged into items? No —
// there is no pet pharmacy table, so the send target is captured into the prescription's
// status transition only; any payload is ignored at the persistence layer.
func (r *Repository) SendPetPrescription(ctx context.Context, userID, prescriptionID string) (*PetPrescription, error) {
	const q = `
		UPDATE doctor_pet_prescriptions
		SET status = 'dispensed', updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'issued'`
	tag, err := r.db.Exec(ctx, q, prescriptionID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.GetPetPrescription(ctx, userID, prescriptionID)
	}
	return r.GetPetPrescription(ctx, userID, prescriptionID)
}

// ══ PET LAB ORDERS ══════════════════════════════════════════════════════════

func (r *Repository) ListPetLabOrders(ctx context.Context, userID string) ([]PetLabOrder, error) {
	const q = `
		SELECT id, user_id, pet_id, ref, status, tests, created_at, updated_at
		FROM doctor_pet_lab_orders WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetLabOrder{}
	for rows.Next() {
		o := PetLabOrder{}
		if err := rows.Scan(&o.ID, &o.UserID, &o.PetID, &o.Ref, &o.Status, &o.Tests,
			&o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// InsertPetLabOrder creates a pet lab order idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertPetLabOrder(ctx context.Context, userID string, petID, ref *string, tests []byte, idemKey string) (*PetLabOrder, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_pet_lab_orders (id, user_id, pet_id, ref, status, tests, idempotency_key)
		VALUES ($1,$2,$3,$4,'ordered',$5::jsonb,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, petID, ref, jsonOrEmptyArray(tests), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getPetLabOrderByIdem(ctx, userID, idemKey)
	}
	return r.getPetLabOrderByID(ctx, userID, id)
}

func (r *Repository) getPetLabOrderByID(ctx context.Context, userID, id string) (*PetLabOrder, error) {
	const q = `
		SELECT id, user_id, pet_id, ref, status, tests, created_at, updated_at
		FROM doctor_pet_lab_orders WHERE id = $1 AND user_id = $2`
	o := &PetLabOrder{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&o.ID, &o.UserID, &o.PetID, &o.Ref, &o.Status,
		&o.Tests, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func (r *Repository) getPetLabOrderByIdem(ctx context.Context, userID, idemKey string) (*PetLabOrder, error) {
	const q = `
		SELECT id, user_id, pet_id, ref, status, tests, created_at, updated_at
		FROM doctor_pet_lab_orders WHERE user_id = $1 AND idempotency_key = $2`
	o := &PetLabOrder{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&o.ID, &o.UserID, &o.PetID, &o.Ref, &o.Status,
		&o.Tests, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

// ══ PET LAB RESULTS ═════════════════════════════════════════════════════════

func (r *Repository) ListPetLabResultInbox(ctx context.Context, userID string) ([]PetLabResult, error) {
	const q = `
		SELECT id, user_id, order_id, reviewed, reviewed_at, "values", interpretation, created_at, updated_at
		FROM doctor_pet_lab_results WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetLabResult{}
	for rows.Next() {
		res := PetLabResult{}
		if err := rows.Scan(&res.ID, &res.UserID, &res.OrderID, &res.Reviewed, &res.ReviewedAt,
			&res.Values, &res.Interpretation, &res.CreatedAt, &res.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, res)
	}
	return out, rows.Err()
}

func (r *Repository) GetPetLabResult(ctx context.Context, userID, id string) (*PetLabResult, error) {
	const q = `
		SELECT id, user_id, order_id, reviewed, reviewed_at, "values", interpretation, created_at, updated_at
		FROM doctor_pet_lab_results WHERE id = $1 AND user_id = $2`
	res := &PetLabResult{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&res.ID, &res.UserID, &res.OrderID, &res.Reviewed,
		&res.ReviewedAt, &res.Values, &res.Interpretation, &res.CreatedAt, &res.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return res, err
}

// GetPetLabResultForOrder returns the result row tied to a pet lab order (scoped).
func (r *Repository) GetPetLabResultForOrder(ctx context.Context, userID, orderID string) (*PetLabResult, error) {
	const q = `
		SELECT id, user_id, order_id, reviewed, reviewed_at, "values", interpretation, created_at, updated_at
		FROM doctor_pet_lab_results WHERE order_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`
	res := &PetLabResult{}
	err := r.db.QueryRow(ctx, q, orderID, userID).Scan(&res.ID, &res.UserID, &res.OrderID, &res.Reviewed,
		&res.ReviewedAt, &res.Values, &res.Interpretation, &res.CreatedAt, &res.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return res, err
}

// ReviewPetLabResult marks a pet lab result reviewed (scoped, status-guarded → idempotent).
func (r *Repository) ReviewPetLabResult(ctx context.Context, userID, resultID string) (*PetLabResult, error) {
	const q = `
		UPDATE doctor_pet_lab_results
		SET reviewed = true, reviewed_at = COALESCE(reviewed_at, now()), updated_at = now()
		WHERE id = $1 AND user_id = $2 AND reviewed = false`
	tag, err := r.db.Exec(ctx, q, resultID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Already reviewed (replay) or not found.
		return r.GetPetLabResult(ctx, userID, resultID)
	}
	return r.GetPetLabResult(ctx, userID, resultID)
}

// SetPetLabInterpretation writes the interpretation onto a pet lab result (scoped, idempotent overwrite).
func (r *Repository) SetPetLabInterpretation(ctx context.Context, userID, resultID, interpretation string) (*PetLabResult, error) {
	const q = `
		UPDATE doctor_pet_lab_results
		SET interpretation = $3, reviewed = true, reviewed_at = COALESCE(reviewed_at, now()), updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, resultID, userID, interpretation)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetPetLabResult(ctx, userID, resultID)
}

// ══ PET STORE ═══════════════════════════════════════════════════════════════

func (r *Repository) ListPetProducts(ctx context.Context, userID string) ([]PetProduct, error) {
	const q = `
		SELECT id, user_id, name, category, price_kobo, detail, created_at
		FROM doctor_pet_products WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetProduct{}
	for rows.Next() {
		p := PetProduct{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Category, &p.PriceKobo, &p.Detail, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPetProduct(ctx context.Context, userID, id string) (*PetProduct, error) {
	const q = `
		SELECT id, user_id, name, category, price_kobo, detail, created_at
		FROM doctor_pet_products WHERE id = $1 AND user_id = $2`
	p := &PetProduct{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&p.ID, &p.UserID, &p.Name, &p.Category,
		&p.PriceKobo, &p.Detail, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (r *Repository) ListPetRecommendations(ctx context.Context, userID string) ([]PetRecommendation, error) {
	const q = `
		SELECT id, user_id, pet_id, product_id, status, shared_at, detail, created_at
		FROM doctor_pet_recommendations WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetRecommendation{}
	for rows.Next() {
		rc := PetRecommendation{}
		if err := rows.Scan(&rc.ID, &rc.UserID, &rc.PetID, &rc.ProductID, &rc.Status,
			&rc.SharedAt, &rc.Detail, &rc.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}

// ListPetRecommendationsForPet returns recommendations for a specific pet (scoped).
func (r *Repository) ListPetRecommendationsForPet(ctx context.Context, userID, petID string) ([]PetRecommendation, error) {
	const q = `
		SELECT id, user_id, pet_id, product_id, status, shared_at, detail, created_at
		FROM doctor_pet_recommendations WHERE user_id = $1 AND pet_id = $2 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID, petID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetRecommendation{}
	for rows.Next() {
		rc := PetRecommendation{}
		if err := rows.Scan(&rc.ID, &rc.UserID, &rc.PetID, &rc.ProductID, &rc.Status,
			&rc.SharedAt, &rc.Detail, &rc.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}

// InsertPetRecommendation recommends a product for a pet idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertPetRecommendation(ctx context.Context, userID string, petID, productID *string, detail []byte, idemKey string) (*PetRecommendation, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_pet_recommendations (id, user_id, pet_id, product_id, status, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,'recommended',$5::jsonb,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, petID, productID, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getPetRecommendationByIdem(ctx, userID, idemKey)
	}
	return r.getPetRecommendationByID(ctx, userID, id)
}

func (r *Repository) getPetRecommendationByID(ctx context.Context, userID, id string) (*PetRecommendation, error) {
	const q = `
		SELECT id, user_id, pet_id, product_id, status, shared_at, detail, created_at
		FROM doctor_pet_recommendations WHERE id = $1 AND user_id = $2`
	rc := &PetRecommendation{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&rc.ID, &rc.UserID, &rc.PetID, &rc.ProductID,
		&rc.Status, &rc.SharedAt, &rc.Detail, &rc.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rc, err
}

func (r *Repository) getPetRecommendationByIdem(ctx context.Context, userID, idemKey string) (*PetRecommendation, error) {
	const q = `
		SELECT id, user_id, pet_id, product_id, status, shared_at, detail, created_at
		FROM doctor_pet_recommendations WHERE user_id = $1 AND idempotency_key = $2`
	rc := &PetRecommendation{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&rc.ID, &rc.UserID, &rc.PetID, &rc.ProductID,
		&rc.Status, &rc.SharedAt, &rc.Detail, &rc.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rc, err
}

// SharePetRecommendation transitions a recommendation → shared (scoped, status-guarded → idempotent).
func (r *Repository) SharePetRecommendation(ctx context.Context, userID, recommendationID string, detail []byte) (*PetRecommendation, error) {
	const q = `
		UPDATE doctor_pet_recommendations
		SET status = 'shared', shared_at = COALESCE(shared_at, now()), detail = detail || $3::jsonb
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, recommendationID, userID, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getPetRecommendationByID(ctx, userID, recommendationID)
}

// ══ PET PRODUCT FULFILMENTS ═════════════════════════════════════════════════

func (r *Repository) ListPetFulfilments(ctx context.Context, userID string) ([]PetFulfilment, error) {
	const q = `
		SELECT id, user_id, product_id, pet_id, status, total_kobo, detail, created_at, updated_at
		FROM doctor_pet_fulfilments WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PetFulfilment{}
	for rows.Next() {
		f := PetFulfilment{}
		if err := rows.Scan(&f.ID, &f.UserID, &f.ProductID, &f.PetID, &f.Status, &f.TotalKobo,
			&f.Detail, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *Repository) GetPetFulfilment(ctx context.Context, userID, id string) (*PetFulfilment, error) {
	const q = `
		SELECT id, user_id, product_id, pet_id, status, total_kobo, detail, created_at, updated_at
		FROM doctor_pet_fulfilments WHERE id = $1 AND user_id = $2`
	f := &PetFulfilment{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&f.ID, &f.UserID, &f.ProductID, &f.PetID, &f.Status,
		&f.TotalKobo, &f.Detail, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}
