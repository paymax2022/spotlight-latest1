package healthrx

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/clinicalsafety"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// State is the prescription lifecycle (HEALTH-BUILD §5):
//
//	ISSUED → SENT_TO_PHARMACY → VERIFYING → VERIFIED → DISPENSED → FULFILLED
//	VERIFYING → REJECTED
//
// invariant HL-3: DISPENSED is terminal-once (no re-dispense). Enforced by the
// guarded transition here AND by a partial UNIQUE index in the schema.
type State string

const (
	StateIssued    State = "ISSUED"
	StateSent      State = "SENT_TO_PHARMACY"
	StateVerifying State = "VERIFYING"
	StateVerified  State = "VERIFIED"
	StateDispensed State = "DISPENSED"
	StateFulfilled State = "FULFILLED"
	StateRejected  State = "REJECTED"
)

var allowedTransitions = map[State]map[State]bool{
	StateIssued:    {StateSent: true},
	StateSent:      {StateVerifying: true},
	StateVerifying: {StateVerified: true, StateRejected: true},
	StateVerified:  {StateDispensed: true},
	StateDispensed: {StateFulfilled: true},
	StateFulfilled: {},
	StateRejected:  {},
}

func canTransition(from, to State) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

type Item struct {
	ID           string `json:"id"`
	DrugName     string `json:"drug_name"`
	NAFDACRef    string `json:"nafdac_ref"`
	IsPOM        bool   `json:"is_pom"`
	IsControlled bool   `json:"is_controlled"` // HL-4: must be false at MVP
	Dosage       string `json:"dosage"`
	// DoseMg is the structured single-dose amount in mg used by the RX-004 dose-range
	// safety check at Issue. 0 = not provided (dose check skipped for this item);
	// Dosage stays the free-text sig for the label.
	DoseMg   float64 `json:"dose_mg"`
	Quantity int     `json:"quantity"`
}

type Prescription struct {
	ID                 string     `json:"id"`
	ConsultID          *string    `json:"consult_id,omitempty"`
	PrescriberID       string     `json:"prescriber_id"`
	PatientID          string     `json:"patient_id"`
	PharmacyProviderID *string    `json:"pharmacy_provider_id,omitempty"`
	VerifiedBy         *string    `json:"verified_by,omitempty"`
	State              State      `json:"state"`
	DispensedAt        *time.Time `json:"dispensed_at,omitempty"`
	RejectReason       string     `json:"reject_reason"`
	Items              []Item     `json:"items,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
}

type Service struct {
	db             *pgxpool.Pool
	audit          Auditor
	clinical       ClinicalContextProvider // optional; supplies allergies/meds for the pre-issue safety screen
	prescriberAuth PrescriberAuthorizer    // optional; scope-of-practice gate at the prescribe boundary (CR-004)
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service {
	return &Service{db: db, audit: audit}
}

// Issue creates an ISSUED prescription with items. HL-4: any controlled item is
// rejected at write (excluded at MVP). HL-1: this only records the clinician's
// order — Paymax neither prescribes nor dispenses.
func (s *Service) Issue(ctx context.Context, prescriberID, patientID string, consultID *string, items []Item) (*Prescription, error) {
	return s.IssueChecked(ctx, prescriberID, patientID, consultID, items, nil, "")
}

// IssueChecked is Issue with the clinical safety screen (§4.2, RX-002/003/004/005,
// VT-003/004). It runs BEFORE any write: a hard-stop finding (drug-allergy,
// contraindicated/major interaction, out-of-range dose, species-toxic/human-only
// drug) blocks issuance with a *SafetyBlockError unless overrideReason documents a
// licensed prescriber's decision to proceed (RX-011), which is then audited.
//
//   - pc != nil: caller supplies the clinical context explicitly (vet passes the
//     pet's species/weight so species-toxicity rules apply).
//   - pc == nil: the injected ClinicalContextProvider is consulted (human path);
//     when none is wired, the screen runs against an empty context (no findings).
func (s *Service) IssueChecked(ctx context.Context, prescriberID, patientID string, consultID *string, items []Item, pc *clinicalsafety.PatientContext, overrideReason string) (*Prescription, error) {
	if prescriberID == "" || patientID == "" {
		return nil, fmt.Errorf("rx: prescriber and patient required")
	}
	// Scope-of-practice gate (CR-004): only a verified, unexpired prescriber may
	// issue. Fail-closed when an authorizer is wired; no-op otherwise.
	if err := authorizePrescriber(ctx, s.prescriberAuth, prescriberID); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("rx: at least one item required")
	}
	for _, it := range items {
		if it.IsControlled {
			return nil, fmt.Errorf("rx: controlled substances are excluded at MVP (HL-4)")
		}
		if strings.TrimSpace(it.DrugName) == "" {
			return nil, fmt.Errorf("rx: item drug_name required")
		}
		if it.Quantity <= 0 {
			return nil, fmt.Errorf("rx: item quantity must be positive")
		}
	}

	// Clinical safety screen (fail-closed on hard stops). Resolve context: explicit
	// (vet) → provider (human) → empty.
	safetyCtx := clinicalsafety.PatientContext{}
	if pc != nil {
		safetyCtx = *pc
	} else if s.clinical != nil {
		if c, ok, cerr := s.clinical.ClinicalContext(ctx, patientID); cerr == nil && ok {
			safetyCtx = c
		}
	}
	safetyRes, serr := screenRx(safetyCtx, items, overrideReason)
	if serr != nil {
		return nil, serr
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("rx: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	p := &Prescription{
		ID:           uuid.New().String(),
		ConsultID:    consultID,
		PrescriberID: prescriberID,
		PatientID:    patientID,
		State:        StateIssued,
		CreatedAt:    time.Now(),
	}
	const insRx = `INSERT INTO health_prescriptions (id, consult_id, prescriber_id, patient_id, state) VALUES ($1,$2,$3,$4,'ISSUED')`
	if _, err := tx.Exec(ctx, insRx, p.ID, consultID, prescriberID, patientID); err != nil {
		return nil, fmt.Errorf("rx: insert prescription: %w", err)
	}
	const insItem = `INSERT INTO health_prescription_items (id, prescription_id, drug_name, nafdac_ref, is_pom, is_controlled, dosage, dose_mg, quantity) VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8)`
	for i := range items {
		items[i].ID = uuid.New().String()
		if _, err := tx.Exec(ctx, insItem, items[i].ID, p.ID, items[i].DrugName, items[i].NAFDACRef, items[i].IsPOM, items[i].Dosage, items[i].DoseMg, items[i].Quantity); err != nil {
			return nil, fmt.Errorf("rx: insert item: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("rx: commit: %w", err)
	}
	p.Items = items
	meta := map[string]any{"items": len(items), "state": string(StateIssued)}
	for k, v := range safetyAudit(safetyRes, overrideReason) {
		meta[k] = v
	}
	s.audited(prescriberID, patientID, "health.rx.issue", p.ID, nil, meta)
	return p, nil
}

// SendToPharmacy moves ISSUED → SENT_TO_PHARMACY and pins the pharmacy provider.
func (s *Service) SendToPharmacy(ctx context.Context, actorID, rxID, pharmacyProviderID string) (*Prescription, error) {
	return s.transition(ctx, actorID, rxID, StateSent, func(tx pgx.Tx, p *prescriptionRow) error {
		if pharmacyProviderID == "" {
			return fmt.Errorf("rx: pharmacy provider required")
		}
		_, err := tx.Exec(ctx, `UPDATE health_prescriptions SET pharmacy_provider_id=$2 WHERE id=$1`, rxID, pharmacyProviderID)
		return err
	}, "health.rx.send")
}

// BeginVerify moves SENT_TO_PHARMACY → VERIFYING (pharmacist picks it up).
func (s *Service) BeginVerify(ctx context.Context, actorID, rxID string) (*Prescription, error) {
	return s.transition(ctx, actorID, rxID, StateVerifying, nil, "health.rx.verify.begin")
}

// Verify is the licensed-pharmacist decision (HL-3). approve → VERIFIED (records
// verified_by); otherwise → REJECTED with a reason.
func (s *Service) Verify(ctx context.Context, pharmacistID, rxID string, approve bool, reason string) (*Prescription, error) {
	to := StateRejected
	if approve {
		to = StateVerified
	}
	return s.transition(ctx, pharmacistID, rxID, to, func(tx pgx.Tx, p *prescriptionRow) error {
		if approve {
			_, err := tx.Exec(ctx, `UPDATE health_prescriptions SET verified_by=$2 WHERE id=$1`, rxID, pharmacistID)
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE health_prescriptions SET reject_reason=$2 WHERE id=$1`, rxID, reason)
		return err
	}, "health.rx.verify")
}

// Dispense moves VERIFIED → DISPENSED. HL-3 dispense-once: the guarded transition
// rejects any state other than VERIFIED, the row is SELECTed FOR UPDATE so two
// concurrent dispenses serialise, and the partial UNIQUE index on (id) WHERE
// state='DISPENSED' is the final DB backstop — a prescription can never be filled
// twice. A POM item additionally requires a recorded pharmacist verification.
func (s *Service) Dispense(ctx context.Context, pharmacistID, rxID string) (*Prescription, error) {
	return s.transition(ctx, pharmacistID, rxID, StateDispensed, func(tx pgx.Tx, p *prescriptionRow) error {
		// HL-3 POM gating: a POM line may only be dispensed after pharmacist verify.
		if p.hasPOM && p.VerifiedBy == nil {
			return fmt.Errorf("rx: POM items require pharmacist verification before dispense (HL-3)")
		}
		_, err := tx.Exec(ctx, `UPDATE health_prescriptions SET dispensed_at=now() WHERE id=$1`, rxID)
		return err
	}, "health.rx.dispense")
}

// Fulfill moves DISPENSED → FULFILLED (handed to patient / delivery rail).
func (s *Service) Fulfill(ctx context.Context, actorID, rxID string) (*Prescription, error) {
	return s.transition(ctx, actorID, rxID, StateFulfilled, nil, "health.rx.fulfill")
}

func (s *Service) Get(ctx context.Context, requesterID, rxID string) (*Prescription, error) {
	p, err := s.load(ctx, rxID)
	if err != nil {
		return nil, err
	}
	// object-level authZ: patient, prescriber, or assigned pharmacist may read.
	if requesterID != p.PatientID && requesterID != p.PrescriberID &&
		(p.VerifiedBy == nil || *p.VerifiedBy != requesterID) {
		return nil, fmt.Errorf("rx: forbidden")
	}
	items, _ := s.loadItems(ctx, rxID)
	p.Items = items
	return p, nil
}

// --- internals ---

// internal carrier carrying the POM flag fetched during the locked read.
type prescriptionRow struct {
	Prescription
	hasPOM bool
}

func (s *Service) transition(ctx context.Context, actorID, rxID string, to State, side func(pgx.Tx, *prescriptionRow) error, action string) (*Prescription, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("rx: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	p, err := lockPrescription(ctx, tx, rxID)
	if err != nil {
		return nil, err
	}
	if p.State == to {
		return &p.Prescription, nil // idempotent re-apply of a terminal-ish edge
	}
	if !canTransition(p.State, to) {
		return nil, fmt.Errorf("rx: illegal transition %s -> %s", p.State, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE health_prescriptions SET state=$2, updated_at=now() WHERE id=$1`, rxID, string(to)); err != nil {
		// HL-3 backstop: a second DISPENSE collides with the partial UNIQUE index.
		return nil, fmt.Errorf("rx: update state: %w", err)
	}
	if side != nil {
		if err := side(tx, p); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("rx: commit: %w", err)
	}
	s.audited(actorID, p.PatientID, action, rxID,
		map[string]any{"state": string(p.State)}, map[string]any{"state": string(to)})
	p.State = to
	return &p.Prescription, nil
}

func lockPrescription(ctx context.Context, tx pgx.Tx, rxID string) (*prescriptionRow, error) {
	var p prescriptionRow
	var state string
	const q = `SELECT id, prescriber_id, patient_id, pharmacy_provider_id, verified_by, state,
	                  EXISTS (SELECT 1 FROM health_prescription_items i WHERE i.prescription_id=health_prescriptions.id AND i.is_pom)
	           FROM health_prescriptions WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, rxID).Scan(&p.ID, &p.PrescriberID, &p.PatientID, &p.PharmacyProviderID, &p.VerifiedBy, &state, &p.hasPOM); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("rx: not found")
		}
		return nil, err
	}
	p.State = State(state)
	return &p, nil
}

func (s *Service) load(ctx context.Context, rxID string) (*Prescription, error) {
	var p Prescription
	var state string
	const q = `SELECT id, consult_id, prescriber_id, patient_id, pharmacy_provider_id, verified_by, state, dispensed_at, reject_reason, created_at
	           FROM health_prescriptions WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, rxID).Scan(&p.ID, &p.ConsultID, &p.PrescriberID, &p.PatientID,
		&p.PharmacyProviderID, &p.VerifiedBy, &state, &p.DispensedAt, &p.RejectReason, &p.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("rx: not found")
		}
		return nil, err
	}
	p.State = State(state)
	return &p, nil
}

func (s *Service) loadItems(ctx context.Context, rxID string) ([]Item, error) {
	const q = `SELECT id, drug_name, nafdac_ref, is_pom, is_controlled, dosage, dose_mg, quantity FROM health_prescription_items WHERE prescription_id=$1`
	rows, err := s.db.Query(ctx, q, rxID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Item
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.DrugName, &it.NAFDACRef, &it.IsPOM, &it.IsControlled, &it.Dosage, &it.DoseMg, &it.Quantity); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_prescription", resourceID, oldV, newV, "", "", "info")
}
