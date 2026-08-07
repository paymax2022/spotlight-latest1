package healthvet

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/clinicalsafety"
	healthconsult "spotlight/backend/internal/health/consult"
	healthrecords "spotlight/backend/internal/health/records"
	healthrx "spotlight/backend/internal/health/rx"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	"spotlight/backend/internal/scheduler"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// EscrowHolder is the funds-hold rail (HL-9). Satisfied by internal/escrow.Service.
// Hold debits the owner into the shared escrow account on booking; Release credits
// the vet payee on COMPLETED; Refund returns funds on CANCELLED. All three are
// idempotent on idemKey (escrow enforces replay-safety internally).
type EscrowHolder interface {
	Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error)
	Release(ctx context.Context, escrowID, payeeID string) error
	Refund(ctx context.Context, escrowID string) error
}

// HoldRef is the minimal projection of an escrow hold the appointment needs.
type HoldRef interface {
	HoldID() string
}

// Dispatcher is the transport last-mile rail (REUSE internal/transport). A home
// visit is a dispatch job on this existing rail — we never rebuild routing.
// CreateDelivery returns an opaque delivery reference tracked by transport.
type Dispatcher interface {
	CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error)
}

// ProviderGate checks HL-2: only a verified (APPROVED VCN) vet is discoverable,
// may list services, accept appointments, and transact. Satisfied by a thin
// adapter over health/providers (health_providers VET capability rows).
type ProviderGate interface {
	// IsApprovedVet reports whether providerID is an APPROVED VCN vet (HL-2).
	IsApprovedVet(ctx context.Context, providerID string) (bool, error)
	// VerifiedVetOwner reports whether userID owns providerID AND it is an
	// APPROVED VCN vet (service/fee governance + accept authority authZ).
	VerifiedVetOwner(ctx context.Context, userID, providerID string) (bool, error)
}

// PayoutGate checks HL-10: provider payouts require the correct KYC tier. The
// release path calls it before crediting the vet.
type PayoutGate interface {
	PayoutEligible(ctx context.Context, ownerUserID string) (bool, error)
}

// Service is the veterinary vertical engine: pet profiles + pet records (vault
// reuse), vet discovery (PostGIS), the appointment + escrow money path (HL-9),
// tele-consult wiring (consult engine + SOAP note), e-prescription (rx engine →
// pharmacy handoff), pet lab order (lab handoff), vaccination scheduler, and
// emergency SOS routing (HL-11). The appointment state machine itself is the
// shared healthscheduling engine — never reimplemented here.
type Service struct {
	db         *pgxpool.Pool
	escrow     EscrowHolder
	dispatch   Dispatcher
	prov       ProviderGate
	payout     PayoutGate
	sched      *healthscheduling.Service
	consult    *healthconsult.Service
	rx         *healthrx.Service
	records    *healthrecords.Service
	jobs       *scheduler.Service
	audit      Auditor
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
}

func NewService(
	db *pgxpool.Pool,
	escrowHolder EscrowHolder,
	dispatch Dispatcher,
	prov ProviderGate,
	payout PayoutGate,
	sched *healthscheduling.Service,
	consult *healthconsult.Service,
	rx *healthrx.Service,
	records *healthrecords.Service,
	jobs *scheduler.Service,
	audit Auditor,
) *Service {
	return &Service{
		db: db, escrow: escrowHolder, dispatch: dispatch, prov: prov, payout: payout,
		sched: sched, consult: consult, rx: rx, records: records, jobs: jobs, audit: audit,
	}
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// vet never imports the commission package at compile time (mirrors the
// transport/doctor seams) — the adapter, which lives in app-wiring, discards the
// returned earning row and surfaces only the error.
//
// This records realized profit ONLY; it never moves money. The vet module's own
// money movements (the appointment escrow HELD→RELEASE of the owner payment to the
// vet) are unchanged, and the injected recorder is deliberately constructed WITHOUT
// a ledger so RecordFor never re-posts to the ledger (no double count of the
// commission revenue account) — it appends the immutable earning row used by profit
// reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a completed vet
// appointment. It is best-effort and MUST NEVER affect the caller's outcome: a nil
// recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the consult completion / vet payout. The
// recorded breakdown is resolved server-side from the central rate card; the source
// ref (the appointment id) doubles as the idempotency key so retries and
// reconciliation sweeps never double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"health.vet", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[health.vet] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// ─── Pet profiles + pet records (REUSE records vault, subject=PET) ───────────

// CreatePet writes an owner-scoped pet profile. The owner is the data-subject
// anchor (object-level authZ). A PET record is seeded in the shared vault (HL-8 —
// consent-gated, access-logged there); the vault is never reimplemented.
func (s *Service) CreatePet(ctx context.Context, ownerID string, p Pet) (*Pet, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("vet: unauthenticated")
	}
	if strings.TrimSpace(p.Name) == "" {
		return nil, fmt.Errorf("vet: pet name required")
	}
	if strings.TrimSpace(p.Species) == "" {
		return nil, fmt.Errorf("vet: pet species required")
	}
	p.ID = uuid.New().String()
	p.OwnerUserID = ownerID
	p.CreatedAt = time.Now()
	const ins = `
		INSERT INTO pets (id, owner_user_id, name, species, breed, sex, birth_date, weight_kg, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
	if _, err := s.db.Exec(ctx, ins, p.ID, p.OwnerUserID, p.Name, p.Species, p.Breed, p.Sex, p.BirthDate, p.WeightKg, p.Notes); err != nil {
		return nil, fmt.Errorf("vet: insert pet: %w", err)
	}
	// Seed the pet's vault record (REUSE records, subject_type=PET). Best-effort:
	// the pet exists regardless; vault failure must not orphan the profile.
	if s.records != nil {
		petRef := p.ID
		if _, err := s.records.Create(ctx, ownerID, ownerID, "PET", "PET_PROFILE", p.Name, "", &petRef); err != nil {
			s.audited(ownerID, "", "health.vet.pet.vault_seed_failed", p.ID, nil, map[string]any{"error": err.Error()})
		}
	}
	// HL-8: do not log pet PII beyond ids/species.
	s.audited(ownerID, "", "health.vet.pet.create", p.ID, nil, map[string]any{"species": p.Species})
	return &p, nil
}

// ListPets returns the caller's own pets only (object-level authZ; HL-8).
func (s *Service) ListPets(ctx context.Context, ownerID string) ([]Pet, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("vet: unauthenticated")
	}
	const q = `SELECT id, owner_user_id, name, species, breed, sex, birth_date, weight_kg, notes, created_at
	           FROM pets WHERE owner_user_id=$1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, fmt.Errorf("vet: list pets: %w", err)
	}
	defer rows.Close()
	var out []Pet
	for rows.Next() {
		var p Pet
		if err := rows.Scan(&p.ID, &p.OwnerUserID, &p.Name, &p.Species, &p.Breed, &p.Sex, &p.BirthDate, &p.WeightKg, &p.Notes, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ownsPet reports whether ownerID owns petID (object-level authZ helper).
func (s *Service) ownsPet(ctx context.Context, ownerID, petID string) (bool, error) {
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pets WHERE id=$1 AND owner_user_id=$2)`, petID, ownerID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// petClinicalContext loads a pet's species + weight into the clinical-safety
// context so veterinary prescribing enforces species-toxicity / human-only-drug
// and weight-based dosing rules (VT-002/003/004). Best-effort: on any read error
// it returns a species-typed context so the animal path never silently falls back
// to human rules.
func (s *Service) petClinicalContext(ctx context.Context, petID string) clinicalsafety.PatientContext {
	pc := clinicalsafety.PatientContext{Species: "animal"}
	var species string
	var weight *float64
	if err := s.db.QueryRow(ctx, `SELECT species, weight_kg FROM pets WHERE id=$1`, petID).Scan(&species, &weight); err == nil {
		if species != "" {
			pc.Species = strings.ToLower(species)
		}
		if weight != nil {
			pc.WeightKg = *weight
		}
	}
	return pc
}

// ─── Vet discovery (map / list; PostGIS) ─────────────────────────────────────

// DiscoverVets returns APPROVED + discoverable VCN vets (HL-2). When lat/lng are
// provided it ranks by PostGIS distance (ST_Distance over geography) within
// radiusM; otherwise it returns a plain list. Parameterised throughout.
func (s *Service) DiscoverVets(ctx context.Context, lat, lng *float64, radiusM float64) ([]VetResult, error) {
	if lat != nil && lng != nil {
		if radiusM <= 0 {
			radiusM = 25000 // 25km default discovery radius
		}
		const gq = `
			SELECT id, display_name, owner_user_id::text,
			       ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng,
			       ST_Distance(geo, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS dist
			FROM health_providers
			WHERE domain='VET' AND provider_type='vet' AND status='APPROVED'
			  AND discoverable = true AND geo IS NOT NULL
			  AND ST_DWithin(geo, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
			ORDER BY dist ASC
			LIMIT 100`
		rows, err := s.db.Query(ctx, gq, *lng, *lat, radiusM)
		if err != nil {
			return nil, fmt.Errorf("vet: discover (geo): %w", err)
		}
		defer rows.Close()
		var out []VetResult
		for rows.Next() {
			var v VetResult
			var vlat, vlng, dist float64
			if err := rows.Scan(&v.ProviderID, &v.DisplayName, &v.OwnerUserID, &vlat, &vlng, &dist); err != nil {
				return nil, err
			}
			v.Lat, v.Lng, v.DistanceM = &vlat, &vlng, &dist
			out = append(out, v)
		}
		return out, nil
	}
	const lq = `
		SELECT id, display_name, owner_user_id::text
		FROM health_providers
		WHERE domain='VET' AND provider_type='vet' AND status='APPROVED' AND discoverable = true
		ORDER BY display_name ASC
		LIMIT 100`
	rows, err := s.db.Query(ctx, lq)
	if err != nil {
		return nil, fmt.Errorf("vet: discover (list): %w", err)
	}
	defer rows.Close()
	var out []VetResult
	for rows.Next() {
		var v VetResult
		if err := rows.Scan(&v.ProviderID, &v.DisplayName, &v.OwnerUserID); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// ─── Services / fees governance ──────────────────────────────────────────────

// UpsertService writes a vet service+fee. HL-2: only the verified vet owner may
// list services for that provider. Price is positive kobo (NL-8).
func (s *Service) UpsertService(ctx context.Context, ownerID string, v VetService) (*VetService, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("vet: unauthenticated")
	}
	if s.prov != nil {
		ok, err := s.prov.VerifiedVetOwner(ctx, ownerID, v.ProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("vet: not a verified VCN vet owner (HL-2)")
		}
	}
	if strings.TrimSpace(v.Name) == "" {
		return nil, fmt.Errorf("vet: service name required")
	}
	if !validVisit(v.VisitType) {
		return nil, fmt.Errorf("vet: invalid visit_type")
	}
	if v.PriceKobo <= 0 {
		return nil, fmt.Errorf("vet: price must be positive kobo")
	}
	if v.ID == "" {
		v.ID = uuid.New().String()
	}
	const q = `
		INSERT INTO vet_services (id, provider_id, code, name, visit_type, price_kobo, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO UPDATE SET
			code=$3, name=$4, visit_type=$5, price_kobo=$6, active=$7, updated_at=now()`
	if _, err := s.db.Exec(ctx, q, v.ID, v.ProviderID, v.Code, v.Name, string(v.VisitType), v.PriceKobo, v.Active); err != nil {
		return nil, fmt.Errorf("vet: upsert service: %w", err)
	}
	s.audited(ownerID, "", "health.vet.service.upsert", v.ID, nil, map[string]any{"visit_type": string(v.VisitType)})
	return &v, nil
}

// ─── Appointment booking + escrow money path (HL-9) ──────────────────────────

// BookInput is the validated appointment-creation payload.
type BookInput struct {
	ProviderID     string
	PetID          string
	ServiceID      string
	VisitType      VisitType
	SlotStart      time.Time
	SlotEnd        time.Time
	IdempotencyKey string
}

// Book creates a PET appointment via the shared scheduling engine (REQUESTED) and
// HELDs the owner's payment on the escrow rail (HL-9). The total is computed
// server-side from the pinned service price in kobo (never trusts the client). The
// whole operation is replay-safe on the idempotency key (escrow.Hold dedups the
// money leg; the vet_appointment_payments row carries a UNIQUE idempotency_key).
func (s *Service) Book(ctx context.Context, ownerID string, in BookInput) (*Appointment, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("vet: unauthenticated")
	}
	if in.IdempotencyKey == "" {
		return nil, fmt.Errorf("vet: idempotency key required (HL-9)")
	}
	if !validVisit(in.VisitType) {
		return nil, fmt.Errorf("vet: visit_type must be TELE, HOME or CLINIC")
	}
	// Object-level authZ: the booker must own the pet (HL-8).
	owns, err := s.ownsPet(ctx, ownerID, in.PetID)
	if err != nil {
		return nil, err
	}
	if !owns {
		return nil, fmt.Errorf("vet: forbidden — not the pet owner")
	}
	// Replay: return the existing appointment for this idempotency key (no re-hold).
	if existing, err := s.getByIdem(ctx, in.IdempotencyKey); err == nil && existing != nil {
		return existing, nil
	}
	// HL-2: book only against a live, verified VCN vet.
	if s.prov != nil {
		ok, err := s.prov.IsApprovedVet(ctx, in.ProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("vet: provider is not an approved VCN vet (HL-2)")
		}
	}
	// Price from the pinned service (server-side, kobo integers).
	var total int64
	var active bool
	const sq = `SELECT price_kobo, active FROM vet_services WHERE id=$1 AND provider_id=$2`
	if err := s.db.QueryRow(ctx, sq, in.ServiceID, in.ProviderID).Scan(&total, &active); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("vet: service not found for this vet")
		}
		return nil, err
	}
	if !active {
		return nil, fmt.Errorf("vet: service is not active")
	}
	if total <= 0 {
		return nil, fmt.Errorf("vet: appointment total must be positive")
	}

	// Create the appointment via the shared scheduling engine (subject_type=PET).
	if s.sched == nil {
		return nil, fmt.Errorf("vet: scheduling engine unavailable")
	}
	appt, err := s.sched.Request(ctx, ownerID, in.ProviderID, "PET", string(in.VisitType), in.SlotStart, in.SlotEnd)
	if err != nil {
		return nil, fmt.Errorf("vet: book slot: %w", err)
	}

	// HL-9: HELD on booking. The escrow debit posts the balanced ledger leg and
	// fails closed on insufficient funds before the payment row is written.
	ref := "vet:" + appt.ID
	hold, err := s.escrow.Hold(ctx, ownerID, ref, "health.vet", in.IdempotencyKey, total)
	if err != nil {
		return nil, fmt.Errorf("vet: hold payment (HL-9): %w", err)
	}
	escrowID := hold.HoldID()

	const insPay = `
		INSERT INTO vet_appointment_payments
			(id, appointment_id, owner_id, provider_id, pet_id, service_id, visit_type,
			 total_kobo, escrow_id, pay_state, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'HELD',$10)`
	if _, err := s.db.Exec(ctx, insPay, uuid.New().String(), appt.ID, ownerID, in.ProviderID,
		in.PetID, in.ServiceID, string(in.VisitType), total, escrowID, in.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("vet: insert appointment payment: %w", err)
	}

	out := &Appointment{
		ID: appt.ID, ProviderID: in.ProviderID, OwnerID: ownerID, PetID: in.PetID,
		ServiceID: in.ServiceID, VisitType: in.VisitType, State: StateRequested,
		PayState: PayHeld, TotalKobo: total, EscrowID: &escrowID,
		SlotStart: in.SlotStart, SlotEnd: in.SlotEnd, CreatedAt: time.Now(),
	}
	s.audited(ownerID, in.ProviderID, "health.vet.appointment.book", appt.ID, nil,
		map[string]any{"state": string(StateRequested), "pay_state": string(PayHeld),
			"total_kobo": total, "escrow_id": escrowID, "visit_type": string(in.VisitType)})
	return out, nil
}

// Accept moves REQUESTED → ACCEPTED. HL-2: only the verified vet owner may accept.
// State transition is delegated to the shared scheduling engine (guarded).
func (s *Service) Accept(ctx context.Context, actorID, apptID string) (*Appointment, error) {
	a, err := s.load(ctx, apptID)
	if err != nil {
		return nil, err
	}
	if s.prov != nil {
		ok, perr := s.prov.VerifiedVetOwner(ctx, actorID, a.ProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("vet: only the verified vet may accept (HL-2)")
		}
	}
	if _, err := s.sched.Transition(ctx, actorID, apptID, healthscheduling.StateAccepted); err != nil {
		return nil, err
	}
	a.State = StateAccepted
	return a, nil
}

// Confirm moves ACCEPTED → CONFIRMED (provider/owner agree on the slot).
func (s *Service) Confirm(ctx context.Context, actorID, apptID string) (*Appointment, error) {
	a, err := s.load(ctx, apptID)
	if err != nil {
		return nil, err
	}
	if _, err := s.sched.Transition(ctx, actorID, apptID, healthscheduling.StateConfirmed); err != nil {
		return nil, err
	}
	a.State = StateConfirmed
	return a, nil
}

// Cancel moves the appointment → CANCELLED and REFUNDS the held payment (HL-9).
// Only the owner or the vet may cancel; the refund is idempotent on the hold and
// flips the pay row to REFUNDED.
func (s *Service) Cancel(ctx context.Context, actorID, apptID, reason string) (*Appointment, error) {
	a, err := s.load(ctx, apptID)
	if err != nil {
		return nil, err
	}
	owner := a.OwnerID
	vetOwner, _ := s.providerOwner(ctx, a.ProviderID)
	if actorID != owner && actorID != vetOwner {
		return nil, fmt.Errorf("vet: forbidden")
	}
	if _, err := s.sched.Transition(ctx, actorID, apptID, healthscheduling.StateCancelled); err != nil {
		return nil, err
	}
	a.State = StateCancelled
	// HL-9: refund the held funds (idempotent). Only refund a still-HELD payment.
	if a.EscrowID != nil && a.PayState == PayHeld {
		if err := s.escrow.Refund(ctx, *a.EscrowID); err != nil {
			return nil, fmt.Errorf("vet: refund payment (HL-9): %w", err)
		}
		if _, err := s.db.Exec(ctx, `UPDATE vet_appointment_payments SET pay_state='REFUNDED', cancel_reason=$2, updated_at=now() WHERE appointment_id=$1 AND pay_state='HELD'`, apptID, reason); err != nil {
			return nil, fmt.Errorf("vet: mark refunded: %w", err)
		}
		a.PayState = PayRefunded
	}
	s.audited(actorID, owner, "health.vet.appointment.cancel", apptID,
		map[string]any{"state": string(a.State), "pay_state": string(PayHeld)},
		map[string]any{"state": string(StateCancelled), "pay_state": string(a.PayState)})
	return a, nil
}

// Dispatch books a home-visit dispatch on the transport last-mile rail (REUSE —
// no routing rebuild) for a HOME-visit appointment and pins the dispatch ref.
// Only the verified vet owner may dispatch.
func (s *Service) Dispatch(ctx context.Context, actorID, apptID string) (*Appointment, error) {
	a, err := s.load(ctx, apptID)
	if err != nil {
		return nil, err
	}
	if a.VisitType != VisitHome {
		return nil, fmt.Errorf("vet: dispatch only applies to HOME visits")
	}
	if s.prov != nil {
		ok, perr := s.prov.VerifiedVetOwner(ctx, actorID, a.ProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("vet: only the verified vet may dispatch (HL-2)")
		}
	}
	if s.dispatch == nil {
		return nil, fmt.Errorf("vet: dispatch rail unavailable")
	}
	ref, derr := s.dispatch.CreateDelivery(ctx, a.OwnerID, "vet-homevisit:"+apptID, apptID+":homevisit")
	if derr != nil {
		return nil, fmt.Errorf("vet: dispatch home visit: %w", derr)
	}
	if _, err := s.db.Exec(ctx, `UPDATE vet_appointment_payments SET delivery_ref=$2, updated_at=now() WHERE appointment_id=$1`, apptID, ref); err != nil {
		return nil, fmt.Errorf("vet: pin dispatch ref: %w", err)
	}
	a.DeliveryRef = &ref
	s.audited(actorID, a.OwnerID, "health.vet.appointment.dispatch", apptID, nil, map[string]any{"delivery_ref": ref})
	return a, nil
}

// ─── Tele-consult wiring (REUSE consult engine) ──────────────────────────────

// StartConsult opens a tele-consult for an appointment: it moves the appointment
// CONFIRMED → IN_PROGRESS (shared scheduling), schedules+starts a consult on the
// shared consult engine (SCHEDULED → IN_PROGRESS), and pins the consult id. HL-2:
// only the verified vet owner starts. The consult engine owns the AV lobby/token.
func (s *Service) StartConsult(ctx context.Context, actorID, apptID string) (*Appointment, error) {
	a, err := s.load(ctx, apptID)
	if err != nil {
		return nil, err
	}
	if s.prov != nil {
		ok, perr := s.prov.VerifiedVetOwner(ctx, actorID, a.ProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("vet: only the verified vet may start the consult (HL-2)")
		}
	}
	if s.consult == nil {
		return nil, fmt.Errorf("vet: consult engine unavailable")
	}
	// Move the appointment into the consult window (guarded by scheduling engine).
	if _, err := s.sched.Transition(ctx, actorID, apptID, healthscheduling.StateInProgress); err != nil {
		return nil, err
	}
	a.State = StateInProgress

	// Reuse the consult engine: schedule then start (SCHEDULED → IN_PROGRESS).
	apptRef := apptID
	c, err := s.consult.Schedule(ctx, a.ProviderID, a.OwnerID, &apptRef)
	if err != nil {
		return nil, fmt.Errorf("vet: schedule consult: %w", err)
	}
	if _, err := s.consult.Start(ctx, actorID, c.ID); err != nil {
		return nil, fmt.Errorf("vet: start consult: %w", err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE vet_appointment_payments SET consult_id=$2, updated_at=now() WHERE appointment_id=$1`, apptID, c.ID); err != nil {
		return nil, fmt.Errorf("vet: pin consult id: %w", err)
	}
	a.ConsultID = &c.ID
	s.audited(actorID, a.OwnerID, "health.vet.consult.start", apptID, nil, map[string]any{"consult_id": c.ID})
	return a, nil
}

// CompleteInput carries the SOAP note and optional care-loop emissions: an
// e-prescription (rx engine → pharmacy handoff) and/or a pet lab order (lab
// handoff). All emissions are recorded by the reused engines; this layer only
// orchestrates the care loop on consult completion.
type CompleteInput struct {
	Subjective string
	Objective  string
	Assessment string
	Plan       string

	// Optional e-prescription (REUSE healthrx). When PharmacyProviderID is set the
	// issued Rx is immediately SENT_TO_PHARMACY (handoff). dispense-once is enforced
	// by the rx engine on the pharmacy side.
	RxItems            []healthrx.Item
	PharmacyProviderID string
	// RxOverrideReason documents a licensed vet's decision to proceed past a
	// clinical-safety hard stop (species-toxic/human-only/interaction). Required to
	// override; audited by the rx engine (RX-011). Empty ⇒ hard stops block.
	RxOverrideReason string

	// Optional pet lab order handoff: the referenced lab + test ids the vet wants
	// run on the pet. The lab vertical owns the LabOrder + payment; this records the
	// referral so the owner can complete the lab booking (care loop).
	LabProviderID string
	LabTestIDs    []string
}

// CompleteResult is the outcome of consult completion.
type CompleteResult struct {
	Appointment   *Appointment                `json:"appointment"`
	ClinicalNote  *healthconsult.ClinicalNote `json:"clinical_note,omitempty"`
	Prescription  *healthrx.Prescription      `json:"prescription,omitempty"`
	LabReferralID *string                     `json:"lab_referral_id,omitempty"`
}

// CompleteConsult completes the tele-consult: it persists the SOAP ClinicalNote on
// the shared consult engine (IN_PROGRESS → COMPLETED), then optionally emits an
// e-prescription (rx engine; SENT_TO_PHARMACY when a pharmacy is named — the
// dispense-once pharmacy handoff) and/or records a pet lab-order referral (lab
// handoff). Finally it moves the appointment IN_PROGRESS → COMPLETED and RELEASES
// the held payment to the vet (HL-9, KYC-gated HL-10). HL-2: only the verified vet
// completes and signs the note.
func (s *Service) CompleteConsult(ctx context.Context, vetOwnerID, apptID string, in CompleteInput) (*CompleteResult, error) {
	a, err := s.load(ctx, apptID)
	if err != nil {
		return nil, err
	}
	if a.ConsultID == nil {
		return nil, fmt.Errorf("vet: no consult started for this appointment")
	}
	vetOwner, err := s.providerOwner(ctx, a.ProviderID)
	if err != nil {
		return nil, err
	}
	if vetOwnerID != vetOwner {
		return nil, fmt.Errorf("vet: only the verified vet may complete the consult (HL-2)")
	}

	res := &CompleteResult{}

	// 1) Persist SOAP note + COMPLETE the consult (shared engine, atomic there).
	note := healthconsult.ClinicalNote{
		Subjective: in.Subjective, Objective: in.Objective,
		Assessment: in.Assessment, Plan: in.Plan,
	}
	_, savedNote, err := s.consult.Complete(ctx, vetOwnerID, *a.ConsultID, note)
	if err != nil {
		return nil, fmt.Errorf("vet: complete consult: %w", err)
	}
	res.ClinicalNote = savedNote

	// 2) Optional e-prescription → pharmacy handoff (REUSE healthrx). The owner is
	// the patient-of-record for the pet's prescription. dispense-once is enforced
	// server-side by the rx engine when the pharmacy dispenses (HL-3).
	if len(in.RxItems) > 0 && s.rx != nil {
		consultRef := *a.ConsultID
		// Species-aware clinical safety screen (VT-002/003/004): pass the pet's
		// species/weight so species-toxic and human-only-drug hard stops fire. A
		// documented override reason (in.RxOverrideReason) is required to proceed
		// past a hard stop and is audited by the rx engine (RX-011).
		petCtx := s.petClinicalContext(ctx, a.PetID)
		p, rerr := s.rx.IssueChecked(ctx, vetOwnerID, a.OwnerID, &consultRef, in.RxItems, &petCtx, in.RxOverrideReason)
		if rerr != nil {
			return nil, fmt.Errorf("vet: issue e-prescription: %w", rerr)
		}
		if strings.TrimSpace(in.PharmacyProviderID) != "" {
			if _, serr := s.rx.SendToPharmacy(ctx, vetOwnerID, p.ID, in.PharmacyProviderID); serr != nil {
				return nil, fmt.Errorf("vet: hand e-prescription to pharmacy: %w", serr)
			}
		}
		res.Prescription = p
	}

	// 3) Optional pet lab-order referral (lab handoff). The lab vertical owns the
	// LabOrder + its own escrow payment; we record the referral so the owner can
	// complete the booking against the named lab/tests (care loop).
	if in.LabProviderID != "" && len(in.LabTestIDs) > 0 {
		refID := uuid.New().String()
		const insRef = `
			INSERT INTO vet_lab_referrals (id, appointment_id, pet_id, owner_id, lab_provider_id, test_ids, ordered_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`
		if _, lerr := s.db.Exec(ctx, insRef, refID, apptID, a.PetID, a.OwnerID, in.LabProviderID, in.LabTestIDs, vetOwnerID); lerr != nil {
			return nil, fmt.Errorf("vet: record lab referral: %w", lerr)
		}
		res.LabReferralID = &refID
		s.audited(vetOwnerID, a.OwnerID, "health.vet.lab_referral.create", refID, nil, map[string]any{"lab_provider_id": in.LabProviderID})
	}

	// 4) COMPLETE the appointment + RELEASE the held payment (HL-9/HL-10).
	if _, err := s.sched.Transition(ctx, vetOwnerID, apptID, healthscheduling.StateCompleted); err != nil {
		return nil, err
	}
	a.State = StateCompleted
	if a.EscrowID != nil && a.PayState == PayHeld {
		// HL-10: gate the vet payee on KYC tier before releasing funds.
		if s.payout != nil {
			ok, perr := s.payout.PayoutEligible(ctx, vetOwner)
			if perr != nil {
				return nil, perr
			}
			if !ok {
				return nil, fmt.Errorf("vet: vet not payout-eligible — KYC tier required (HL-10)")
			}
		}
		if err := s.escrow.Release(ctx, *a.EscrowID, vetOwner); err != nil {
			return nil, fmt.Errorf("vet: release payment (HL-9): %w", err)
		}
		if _, err := s.db.Exec(ctx, `UPDATE vet_appointment_payments SET pay_state='RELEASED', updated_at=now() WHERE appointment_id=$1 AND pay_state='HELD'`, apptID); err != nil {
			return nil, fmt.Errorf("vet: mark released: %w", err)
		}
		a.PayState = PayReleased
		// Vet-appointment settlement point: the consult completion + escrow release
		// realizes Spotlight's commission. Record realized profit into the central
		// Commission & Profit registry — best-effort + idempotent (the appointment id
		// doubles as source ref + idempotency key, so retries never double-count).
		// gross = the full appointment total the owner paid (the same basis the vet's
		// own escrow split settles on). A recorder failure is logged and swallowed —
		// it must NEVER fail or reverse the release above. Nil recorder ⇒ no-op
		// (commission feature off). Guarded by the same HELD→RELEASED transition so it
		// records exactly once per appointment.
		ownerRef := a.OwnerID
		s.recordCommissionSafe(ctx, "Health", "Veterinary", "", a.TotalKobo, apptID, &ownerRef)
	}
	s.audited(vetOwnerID, a.OwnerID, "health.vet.consult.complete", apptID,
		map[string]any{"state": string(StateInProgress), "pay_state": string(PayHeld)},
		map[string]any{"state": string(StateCompleted), "pay_state": string(a.PayState)})
	res.Appointment = a
	return res, nil
}

// ─── Vaccination scheduler + reminders (REUSE scheduler) ─────────────────────

// ScheduleVaccination records a due vaccination for a pet and schedules a reminder
// on the shared scheduler (REUSE — never rebuilt). Object-level authZ: the caller
// must own the pet.
func (s *Service) ScheduleVaccination(ctx context.Context, ownerID, petID, vaccine string, dueAt time.Time) (*Vaccination, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("vet: unauthenticated")
	}
	owns, err := s.ownsPet(ctx, ownerID, petID)
	if err != nil {
		return nil, err
	}
	if !owns {
		return nil, fmt.Errorf("vet: forbidden — not the pet owner")
	}
	if strings.TrimSpace(vaccine) == "" {
		return nil, fmt.Errorf("vet: vaccine required")
	}
	v := &Vaccination{
		ID: uuid.New().String(), PetID: petID, OwnerUserID: ownerID,
		Vaccine: vaccine, DueAt: dueAt, CreatedAt: time.Now(),
	}
	const ins = `INSERT INTO vaccination_schedules (id, pet_id, owner_user_id, vaccine, due_at)
	             VALUES ($1,$2,$3,$4,$5)`
	if _, err := s.db.Exec(ctx, ins, v.ID, v.PetID, v.OwnerUserID, v.Vaccine, v.DueAt); err != nil {
		return nil, fmt.Errorf("vet: insert vaccination: %w", err)
	}
	// Reminder one day before due — reused scheduler primitive (no rebuild).
	if s.jobs != nil {
		remindAt := dueAt.Add(-24 * time.Hour)
		if remindAt.After(time.Now()) {
			job, jerr := s.jobs.Schedule(ctx, scheduler.Job{
				JobType:     "health.vet.vaccination.reminder",
				OwnerUserID: ownerID,
				EntityRef:   v.ID,
				Payload:     map[string]any{"vaccination_id": v.ID, "pet_id": petID, "vaccine": vaccine},
				NextRunAt:   remindAt,
				MaxRuns:     1,
			})
			if jerr == nil && job != nil {
				_, _ = s.db.Exec(ctx, `UPDATE vaccination_schedules SET reminder_job_id=$2 WHERE id=$1`, v.ID, job.ID)
				v.ReminderJobID = &job.ID
			}
		}
	}
	s.audited(ownerID, "", "health.vet.vaccination.schedule", v.ID, nil, map[string]any{"vaccine": vaccine})
	return v, nil
}

// ─── Emergency vet (SOS) routing — HL-11 ─────────────────────────────────────

// SOSResult is the emergency routing response: the nearest in-person (HOME/CLINIC)
// vet(s) plus a mandatory disclaimer. Tele is deliberately excluded from SOS.
type SOSResult struct {
	Disclaimer string      `json:"disclaimer"`
	Vets       []VetResult `json:"vets"`
}

// EmergencySOS implements HL-11: tele-consult is NOT a substitute for emergency
// care. An SOS request routes the owner to the nearest verified IN-PERSON vet
// (PostGIS distance, capped radius) and ALWAYS returns a clear disclaimer. It
// never books a tele appointment and never auto-charges.
func (s *Service) EmergencySOS(ctx context.Context, ownerID string, lat, lng float64) (*SOSResult, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("vet: unauthenticated")
	}
	// Route to nearest in-person vets only (tele excluded by design — HL-11).
	vets, err := s.DiscoverVets(ctx, &lat, &lng, 50000) // wider 50km emergency radius
	if err != nil {
		return nil, err
	}
	s.audited(ownerID, "", "health.vet.sos", ownerID, nil, map[string]any{"results": len(vets)})
	return &SOSResult{
		Disclaimer: "EMERGENCY: A tele-consult is NOT a substitute for emergency veterinary care. " +
			"If your pet is in distress, go to the nearest in-person veterinary clinic immediately or " +
			"call the listed vet directly. The following are the nearest verified in-person vets.",
		Vets: vets,
	}, nil
}

// ─── Reads / object-level authZ ──────────────────────────────────────────────

// Get returns an appointment with object-level authZ: the owner, the owning vet,
// or an admin may read (HL-8).
func (s *Service) Get(ctx context.Context, requesterID, apptID string, isAdmin bool) (*Appointment, error) {
	a, err := s.load(ctx, apptID)
	if err != nil {
		return nil, err
	}
	vetOwner, _ := s.providerOwner(ctx, a.ProviderID)
	if !isAdmin && requesterID != a.OwnerID && requesterID != vetOwner {
		return nil, fmt.Errorf("vet: forbidden")
	}
	return a, nil
}

// ─── internals ──────────────────────────────────────────────────────────────

// load joins the scheduling row (authoritative state/slot) with the vet payment
// row (money leg + care-loop refs).
func (s *Service) load(ctx context.Context, apptID string) (*Appointment, error) {
	var a Appointment
	var state, visit, payState string
	const q = `
		SELECT ap.id, ap.provider_id, ap.patient_id, ap.visit_type, ap.state, ap.slot_start, ap.slot_end,
		       vp.pet_id, vp.service_id, vp.total_kobo, vp.escrow_id, vp.consult_id, vp.delivery_ref, vp.pay_state, ap.created_at
		FROM health_appointments ap
		JOIN vet_appointment_payments vp ON vp.appointment_id = ap.id
		WHERE ap.id=$1`
	if err := s.db.QueryRow(ctx, q, apptID).Scan(&a.ID, &a.ProviderID, &a.OwnerID, &visit, &state,
		&a.SlotStart, &a.SlotEnd, &a.PetID, &a.ServiceID, &a.TotalKobo, &a.EscrowID, &a.ConsultID,
		&a.DeliveryRef, &payState, &a.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("vet: appointment not found")
		}
		return nil, err
	}
	a.State = ApptState(state)
	a.VisitType = VisitType(visit)
	a.PayState = PayState(payState)
	return &a, nil
}

func (s *Service) getByIdem(ctx context.Context, idemKey string) (*Appointment, error) {
	var apptID string
	if err := s.db.QueryRow(ctx, `SELECT appointment_id FROM vet_appointment_payments WHERE idempotency_key=$1`, idemKey).Scan(&apptID); err != nil {
		return nil, err
	}
	return s.load(ctx, apptID)
}

func (s *Service) providerOwner(ctx context.Context, providerID string) (string, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT owner_user_id::text FROM health_providers WHERE id=$1`, providerID).Scan(&owner); err != nil {
		return "", fmt.Errorf("vet: provider not found")
	}
	return owner, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_vet", resourceID, oldV, newV, "", "", "info")
}

// ─── Admin reads (RBAC health.vet.* applied at route registration) ───────────

// AdminAppointment is the admin oversight projection of an appointment + money leg.
type AdminAppointment struct {
	AppointmentID string  `json:"appointment_id"`
	ProviderID    string  `json:"provider_id"`
	OwnerID       string  `json:"owner_id"`
	PetID         string  `json:"pet_id"`
	VisitType     string  `json:"visit_type"`
	State         string  `json:"state"`
	PayState      string  `json:"pay_state"`
	TotalKobo     int64   `json:"total_kobo"`
	ConsultID     *string `json:"consult_id,omitempty"`
}

// AdminListAppointments returns appointments for oversight, optionally filtered by
// state and vet provider. Admin-basis read (caller already RBAC-gated).
func (s *Service) AdminListAppointments(ctx context.Context, state, providerID string) ([]AdminAppointment, error) {
	const q = `
		SELECT ap.id, vp.provider_id, vp.owner_id, vp.pet_id, vp.visit_type, ap.state, vp.pay_state, vp.total_kobo, vp.consult_id
		FROM vet_appointment_payments vp
		JOIN health_appointments ap ON ap.id = vp.appointment_id
		WHERE ($1='' OR ap.state=$1) AND ($2='' OR vp.provider_id::text=$2)
		ORDER BY ap.created_at DESC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, state, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminAppointment
	for rows.Next() {
		var a AdminAppointment
		if err := rows.Scan(&a.AppointmentID, &a.ProviderID, &a.OwnerID, &a.PetID, &a.VisitType, &a.State, &a.PayState, &a.TotalKobo, &a.ConsultID); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// AdminVCNAudit lists VET-domain providers with their verification status for the
// VCN credential audit (HL-2/HL-12).
func (s *Service) AdminVCNAudit(ctx context.Context) ([]map[string]any, error) {
	const q = `
		SELECT id::text, owner_user_id::text, display_name, status, discoverable
		FROM health_providers
		WHERE domain='VET'
		ORDER BY created_at DESC
		LIMIT 500`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, owner, name, status string
		var disc bool
		if err := rows.Scan(&id, &owner, &name, &status, &disc); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"provider_id": id, "owner_user_id": owner, "display_name": name,
			"status": status, "discoverable": disc,
		})
	}
	return out, nil
}

// AdminERxAudit lists prescriptions emitted from vet consults for the e-Rx audit
// (HL-3/HL-12). Bodies/PII are never surfaced — ids + state + counts only.
func (s *Service) AdminERxAudit(ctx context.Context, providerID string) ([]map[string]any, error) {
	const q = `
		SELECT rp.id::text, rp.prescriber_id::text, rp.patient_id::text, rp.state,
		       COALESCE(rp.pharmacy_provider_id::text,''), rp.created_at
		FROM health_prescriptions rp
		JOIN vet_appointment_payments vp ON vp.consult_id = rp.consult_id
		WHERE ($1='' OR vp.provider_id::text=$1)
		ORDER BY rp.created_at DESC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, prescriber, patient, state, pharmacy string
		var created time.Time
		if err := rows.Scan(&id, &prescriber, &patient, &state, &pharmacy, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"prescription_id": id, "prescriber_id": prescriber, "patient_id": patient,
			"state": state, "pharmacy_provider_id": pharmacy, "created_at": created,
		})
	}
	return out, nil
}

// AdminDeactivateService disables a vet service from the catalog (fee governance).
func (s *Service) AdminDeactivateService(ctx context.Context, adminID, serviceID string) error {
	ct, err := s.db.Exec(ctx, `UPDATE vet_services SET active=false, updated_at=now() WHERE id=$1`, serviceID)
	if err != nil {
		return fmt.Errorf("vet: deactivate service: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("vet: service not found")
	}
	s.audited(adminID, "", "health.vet.service.deactivate", serviceID, nil, map[string]any{"active": false})
	return nil
}
