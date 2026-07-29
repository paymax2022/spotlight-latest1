package healthlab

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// EscrowHolder is the funds-hold rail (HL-9). Satisfied by internal/escrow.Service.
// Hold debits the payer into the shared escrow account on CREATED; Release credits
// the lab payee on RELEASED; Refund returns funds on CANCELLED. All three are
// idempotent on idemKey (escrow enforces replay-safety internally).
type EscrowHolder interface {
	Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error)
	Release(ctx context.Context, escrowID, payeeID string) error
	Refund(ctx context.Context, escrowID string) error
}

// HoldRef is the minimal projection of an escrow hold the order needs.
type HoldRef interface {
	HoldID() string
}

// Dispatcher is the transport last-mile rail (REUSE internal/transport). A
// phlebotomist dispatch (home collection) and the results courier are dispatch
// jobs on this existing rail — we never rebuild routing. CreateDelivery returns an
// opaque delivery reference tracked by the transport module.
type Dispatcher interface {
	CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error)
}

// ProviderGate checks HL-2: only a verified (APPROVED) MLSCN lab may list a
// catalog and transact; only the lab's verified phlebotomist may collect samples;
// only the lab's verified scientist may enter/validate/release results. Satisfied
// by a thin adapter over health/providers (health_providers + capability roles).
type ProviderGate interface {
	// IsApprovedLab reports whether the provider is an APPROVED MLSCN lab (HL-2).
	IsApprovedLab(ctx context.Context, providerID string) (bool, error)
	// VerifiedLabOwner reports whether userID owns the given lab provider AND it is
	// APPROVED (catalog governance authZ).
	VerifiedLabOwner(ctx context.Context, userID, providerID string) (bool, error)
	// IsVerifiedScientist reports whether userID holds a verified lab_scientist
	// capability for the lab (HL-7 sign-off authority; HL-2 credential-gated).
	IsVerifiedScientist(ctx context.Context, userID, providerID string) (bool, error)
	// IsVerifiedPhlebotomist reports whether userID holds a verified phlebotomist
	// capability for the lab (home-collection dispatch authority; HL-2).
	IsVerifiedPhlebotomist(ctx context.Context, userID, providerID string) (bool, error)
}

// PayoutGate checks HL-10: provider payouts require the correct KYC tier. nil is
// treated as "not gated" only in non-payout paths; result release calls it.
type PayoutGate interface {
	PayoutEligible(ctx context.Context, ownerUserID string) (bool, error)
}

// Notifier is the HL-7 human-escalation channel. On a critical/abnormal result the
// service notifies the patient AND the ordering clinician — never a silent in-app
// flag. Satisfied by an adapter over the notifications service; nil is safe but
// escalation is then recorded only via audit + the escalated state.
type Notifier interface {
	NotifyCriticalResult(ctx context.Context, patientID, orderID string, status string) error
}

// RecordsVault is the NDPA records vault (REUSE health/records, HL-8). Result
// release writes the authoritative result into the patient's vault as a record +
// signed-URL document; reads are consent-gated and access-logged there. Create
// returns the new record id which is pinned onto the order.
type RecordsVault interface {
	Create(ctx context.Context, ownerID, createdBy, subjectType, recordType, title, body string, petRef *string) (string, error)
}

// Service is the LabOrder + catalog + sample/custody + result engine.
type Service struct {
	db       *pgxpool.Pool
	escrow   EscrowHolder
	dispatch Dispatcher
	prov     ProviderGate
	payout   PayoutGate
	notify   Notifier
	vault    RecordsVault
	audit    Auditor
}

func NewService(db *pgxpool.Pool, escrow EscrowHolder, dispatch Dispatcher, prov ProviderGate, payout PayoutGate, notify Notifier, vault RecordsVault, audit Auditor) *Service {
	return &Service{db: db, escrow: escrow, dispatch: dispatch, prov: prov, payout: payout, notify: notify, vault: vault, audit: audit}
}

// ─── Catalog (HL-1: lab defines tests; HL-2: only a verified lab lists) ──────

// UpsertTest writes a catalog test. HL-2: only the verified lab owner may list
// tests for that lab. Prep instructions + TAT are surfaced to the patient.
func (s *Service) UpsertTest(ctx context.Context, ownerID string, t Test) (*Test, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("lab: unauthenticated")
	}
	if s.prov != nil {
		ok, err := s.prov.VerifiedLabOwner(ctx, ownerID, t.LabProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("lab: not a verified lab owner (HL-2)")
		}
	}
	if strings.TrimSpace(t.Name) == "" {
		return nil, fmt.Errorf("lab: test name required")
	}
	if t.PriceKobo <= 0 {
		return nil, fmt.Errorf("lab: price must be positive kobo")
	}
	if t.TATHours < 0 {
		return nil, fmt.Errorf("lab: tat_hours must be non-negative")
	}
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	const q = `
		INSERT INTO lab_tests
			(id, lab_provider_id, code, name, specimen, prep_instructions, tat_hours, ref_range, price_kobo, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (id) DO UPDATE SET
			code=$3, name=$4, specimen=$5, prep_instructions=$6, tat_hours=$7, ref_range=$8,
			price_kobo=$9, active=$10, updated_at=now()`
	if _, err := s.db.Exec(ctx, q, t.ID, t.LabProviderID, t.Code, t.Name, t.Specimen,
		t.PrepInstructions, t.TATHours, t.RefRange, t.PriceKobo, t.Active); err != nil {
		return nil, fmt.Errorf("lab: upsert test: %w", err)
	}
	s.audited(ownerID, "", "health.lab.test.upsert", t.ID, nil,
		map[string]any{"name": t.Name, "price_kobo": t.PriceKobo, "tat_hours": t.TATHours})
	return &t, nil
}

// ListTests returns the active catalog (tests + packages) for a lab. The catalog
// read is a plain active filter; prep instructions + TAT are surfaced.
func (s *Service) ListTests(ctx context.Context, labProviderID string) ([]Test, error) {
	const base = `
		SELECT id, lab_provider_id, code, name, specimen, prep_instructions, tat_hours, ref_range, price_kobo, active, created_at
		FROM lab_tests WHERE active = true`
	q := base + labFilter(labProviderID) + ` ORDER BY name ASC LIMIT 200`
	var rows pgx.Rows
	var err error
	if labProviderID != "" {
		rows, err = s.db.Query(ctx, q, labProviderID)
	} else {
		rows, err = s.db.Query(ctx, q)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Test
	for rows.Next() {
		var t Test
		if err := rows.Scan(&t.ID, &t.LabProviderID, &t.Code, &t.Name, &t.Specimen,
			&t.PrepInstructions, &t.TATHours, &t.RefRange, &t.PriceKobo, &t.Active, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func labFilter(id string) string {
	if id == "" {
		return ""
	}
	return " AND lab_provider_id = $1"
}

// ─── LabOrder lifecycle ──────────────────────────────────────────────────────

// CreateOrderInput is the validated order-creation payload.
type CreateOrderInput struct {
	LabProviderID    string
	CollectionMethod CollectionMethod
	IdempotencyKey   string
	TestIDs          []string
}

// CreateOrder builds a LabOrder and HELDs the patient payment on the escrow rail
// (HL-9). The total is computed server-side from current catalog prices in kobo
// (never trusts the client). The whole operation is replay-safe on the idempotency
// key (escrow.Hold dedups the money leg, the order row carries a UNIQUE
// idempotency_key).
func (s *Service) CreateOrder(ctx context.Context, patientID string, in CreateOrderInput) (*Order, error) {
	if patientID == "" {
		return nil, fmt.Errorf("lab: unauthenticated")
	}
	if in.IdempotencyKey == "" {
		return nil, fmt.Errorf("lab: idempotency key required (HL-9)")
	}
	if len(in.TestIDs) == 0 {
		return nil, fmt.Errorf("lab: at least one test required")
	}
	if in.CollectionMethod != CollectHome && in.CollectionMethod != CollectWalkIn {
		return nil, fmt.Errorf("lab: collection_method must be HOME or WALK_IN")
	}
	// Replay: return the existing order for this idempotency key (no double-hold).
	if existing, err := s.getByIdem(ctx, in.IdempotencyKey); err == nil && existing != nil {
		return existing, nil
	}
	// HL-2: order only against a live, verified MLSCN lab.
	if s.prov != nil {
		ok, err := s.prov.IsApprovedLab(ctx, in.LabProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("lab: supplier is not an approved MLSCN lab (HL-2)")
		}
	}

	// Price every line from the catalog (server-side, kobo integers).
	var total int64
	lines := make([]OrderLine, 0, len(in.TestIDs))
	for _, testID := range in.TestIDs {
		var name string
		var price int64
		var active bool
		const tq = `SELECT name, price_kobo, active FROM lab_tests WHERE id=$1 AND lab_provider_id=$2`
		if err := s.db.QueryRow(ctx, tq, testID, in.LabProviderID).Scan(&name, &price, &active); err != nil {
			if err == pgx.ErrNoRows {
				return nil, fmt.Errorf("lab: test not found in this lab catalog")
			}
			return nil, err
		}
		if !active {
			return nil, fmt.Errorf("lab: test is not active")
		}
		total += price
		lines = append(lines, OrderLine{
			ID: uuid.New().String(), TestID: testID, TestName: name, UnitPriceKobo: price,
		})
	}
	if total <= 0 {
		return nil, fmt.Errorf("lab: order total must be positive")
	}

	orderID := uuid.New().String()
	ref := "lab:" + orderID

	// HL-9: HELD on CREATED. The escrow debit posts the balanced ledger leg and
	// fails closed on insufficient funds before any order row is written.
	hold, err := s.escrow.Hold(ctx, patientID, ref, "health.lab", in.IdempotencyKey, total)
	if err != nil {
		return nil, fmt.Errorf("lab: hold payment: %w", err)
	}
	escrowID := hold.HoldID()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("lab: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	const insOrder = `
		INSERT INTO lab_orders
			(id, patient_id, lab_provider_id, state, collection_method, total_kobo, escrow_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := tx.Exec(ctx, insOrder, orderID, patientID, in.LabProviderID,
		string(StateCreated), string(in.CollectionMethod), total, escrowID, in.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("lab: insert order: %w", err)
	}
	const insLine = `
		INSERT INTO lab_order_lines (id, order_id, test_id, test_name, unit_price_kobo)
		VALUES ($1,$2,$3,$4,$5)`
	for i := range lines {
		lines[i].OrderID = orderID
		if _, err := tx.Exec(ctx, insLine, lines[i].ID, orderID, lines[i].TestID, lines[i].TestName, lines[i].UnitPriceKobo); err != nil {
			return nil, fmt.Errorf("lab: insert line: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("lab: commit order: %w", err)
	}

	o := &Order{
		ID: orderID, PatientID: patientID, LabProviderID: in.LabProviderID,
		State: StateCreated, CollectionMethod: in.CollectionMethod, TotalKobo: total,
		EscrowID: &escrowID, IdempotencyKey: in.IdempotencyKey, Lines: lines, CreatedAt: time.Now(),
	}
	s.audited(patientID, "", "health.lab.order.create", orderID, nil,
		map[string]any{"state": string(StateCreated), "total_kobo": total, "escrow_id": escrowID,
			"collection_method": string(in.CollectionMethod)})
	return o, nil
}

// Schedule moves CREATED → SCHEDULED. For a HOME collection it dispatches a
// phlebotomist on the transport last-mile rail (REUSE — no routing rebuild) and
// pins the returned dispatch reference. Walk-in orders schedule without dispatch.
func (s *Service) Schedule(ctx context.Context, actorID, orderID string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	var deliveryRef *string
	if o.CollectionMethod == CollectHome && s.dispatch != nil {
		ref, derr := s.dispatch.CreateDelivery(ctx, o.PatientID, "lab-collect:"+orderID, o.IdempotencyKey+":collect")
		if derr != nil {
			return nil, fmt.Errorf("lab: dispatch phlebotomist: %w", derr)
		}
		deliveryRef = &ref
	}
	out, err := s.transition(ctx, actorID, orderID, StateScheduled, func(tx pgx.Tx, cur *Order) error {
		_, e := tx.Exec(ctx, `UPDATE lab_orders SET delivery_ref=$2 WHERE id=$1`, orderID, deliveryRef)
		return e
	}, "health.lab.order.schedule")
	if err != nil {
		return nil, err
	}
	out.DeliveryRef = deliveryRef
	return out, nil
}

// Collect is the phlebotomist (HOME) or lab intake (WALK_IN) action that creates
// the Sample and opens the chain of custody (HL-6). It moves the order SCHEDULED →
// SAMPLE_COLLECTED, mints a barcode, and writes the first immutable custody event
// (→ COLLECTED). The collector becomes the initial custodian. Only the lab's
// verified phlebotomist may collect a HOME sample (HL-2).
func (s *Service) Collect(ctx context.Context, collectorID, orderID, note string) (*Sample, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.State != StateScheduled {
		return nil, fmt.Errorf("lab: order must be SCHEDULED before collection, is %s", o.State)
	}
	// HL-2: a HOME collection requires a verified phlebotomist of this lab.
	if o.CollectionMethod == CollectHome && s.prov != nil {
		ok, perr := s.prov.IsVerifiedPhlebotomist(ctx, collectorID, o.LabProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("lab: only a verified phlebotomist may collect (HL-2)")
		}
	}
	// One sample per order (HL-6: the order's specimen is a single tracked entity).
	if existing, _ := s.sampleByOrder(ctx, orderID); existing != nil {
		return existing, nil
	}

	sampleID := uuid.New().String()
	barcode := generateBarcode()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("lab: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	const insSample = `
		INSERT INTO lab_samples (id, order_id, state, collection_method, custodian_id, barcode_ref, collected_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := tx.Exec(ctx, insSample, sampleID, orderID, string(SampleCollected),
		string(o.CollectionMethod), collectorID, barcode, collectorID); err != nil {
		return nil, fmt.Errorf("lab: insert sample: %w", err)
	}
	// HL-6: first immutable custody event (chain origin).
	if err := appendCustody(ctx, tx, sampleID, "", SampleCollected, collectorID, nil, &collectorID, note); err != nil {
		return nil, err
	}
	// Order → SAMPLE_COLLECTED (guarded inside the same tx).
	if err := s.transitionTx(ctx, tx, collectorID, o, StateSampleCollected); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("lab: commit collect: %w", err)
	}

	sample := &Sample{
		ID: sampleID, OrderID: orderID, State: SampleCollected, CollectionMethod: o.CollectionMethod,
		CustodianID: &collectorID, BarcodeRef: barcode, CollectedBy: &collectorID, CollectedAt: time.Now(),
	}
	s.audited(collectorID, o.PatientID, "health.lab.sample.collect", sampleID, nil,
		map[string]any{"order_id": orderID, "state": string(SampleCollected), "barcode": barcode})
	return sample, nil
}

// Handover records a custody transfer (e.g. phlebotomist → courier → lab) as an
// immutable custody event and moves the sample COLLECTED/IN_CUSTODY → HANDED_OVER,
// optionally dispatching a results-courier / sample-courier on the transport rail.
// HL-6: each handover is logged; the chain stays unbroken.
func (s *Service) Handover(ctx context.Context, actorID, sampleID, toCustodianID, note string) (*Sample, error) {
	sm, err := s.loadSample(ctx, sampleID)
	if err != nil {
		return nil, err
	}
	to := SampleHandedOver
	target := sm.State
	switch target {
	case SampleCollected, SampleInCustody:
		// ok
	default:
		return nil, fmt.Errorf("lab: sample not in a handover-able state, is %s", sm.State)
	}
	var newCustodian *string
	if toCustodianID != "" {
		newCustodian = &toCustodianID
	}
	out, err := s.transitionSample(ctx, actorID, sampleID, to, newCustodian, note, "health.lab.sample.handover")
	if err != nil {
		return nil, err
	}
	return out, nil
}

// FlagBreach records a detected chain-of-custody break (HL-6). The sample → BREACHED
// then immediately → RECOLLECT_REQUIRED. No result may be produced for a breached
// sample; a fresh collection is required. The breach + recollect are immutable
// custody events.
func (s *Service) FlagBreach(ctx context.Context, actorID, sampleID, reason string) (*Sample, error) {
	if _, err := s.transitionSample(ctx, actorID, sampleID, SampleBreached, nil, reason, "health.lab.sample.breach"); err != nil {
		return nil, err
	}
	return s.transitionSample(ctx, actorID, sampleID, SampleRecollectRequired, nil, "recollection required after breach", "health.lab.sample.recollect")
}

// Accession is the lab intake action (HL-6 gate): the sample must have an UNBROKEN
// chain and be in HANDED_OVER (or COLLECTED for a walk-in) before it is accepted.
// A BREACHED / RECOLLECT_REQUIRED sample is rejected — no result without a
// complete custody chain. On success the sample → ACCESSIONED, the order
// SAMPLE_COLLECTED/IN_TRANSIT → ACCESSIONED, then → PROCESSING.
func (s *Service) Accession(ctx context.Context, scientistID, sampleID, scannedBarcode, note string) (*Sample, error) {
	sm, err := s.loadSample(ctx, sampleID)
	if err != nil {
		return nil, err
	}
	o, err := s.load(ctx, sm.OrderID)
	if err != nil {
		return nil, err
	}
	// HL-2: only a verified scientist of this lab may accession.
	if s.prov != nil {
		ok, perr := s.prov.IsVerifiedScientist(ctx, scientistID, o.LabProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("lab: only a verified lab scientist may accession (HL-2)")
		}
	}
	// Sample↔patient integrity (EC-001/LB-005): if the accessioning scientist
	// scanned the tube, the barcode MUST match the one minted at collection — a
	// mismatch is a possible swap/mislabel and is rejected before intake.
	if err := verifyBarcodeScan(scannedBarcode, sm.BarcodeRef); err != nil {
		s.audited(scientistID, o.PatientID, "health.lab.sample.barcode_mismatch", sampleID, nil,
			map[string]any{"scanned": normalizeBarcode(scannedBarcode), "expected": sm.BarcodeRef})
		return nil, err
	}
	// HL-6: an unbroken chain is mandatory. Breach/recollect cannot be accessioned.
	if !chainIntact(sm.State) {
		return nil, fmt.Errorf("lab: cannot accession — chain of custody is broken (%s); recollection required (HL-6)", sm.State)
	}
	if sm.State == SampleAccessioned {
		return sm, nil // idempotent
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("lab: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Re-read sample under lock to defend against a concurrent breach.
	locked, err := lockSample(ctx, tx, sampleID)
	if err != nil {
		return nil, err
	}
	if !chainIntact(locked.State) {
		return nil, fmt.Errorf("lab: cannot accession — chain of custody is broken (%s) (HL-6)", locked.State)
	}
	if !canTransitionSample(locked.State, SampleAccessioned) {
		return nil, fmt.Errorf("lab: illegal sample transition %s -> ACCESSIONED", locked.State)
	}
	if _, err := tx.Exec(ctx, `UPDATE lab_samples SET state=$2, custodian_id=$3 WHERE id=$1`, sampleID, string(SampleAccessioned), scientistID); err != nil {
		return nil, fmt.Errorf("lab: accession sample: %w", err)
	}
	if err := appendCustody(ctx, tx, sampleID, locked.State, SampleAccessioned, scientistID, locked.CustodianID, &scientistID, note); err != nil {
		return nil, err
	}
	// Order → ACCESSIONED → PROCESSING. Accept either SAMPLE_COLLECTED or IN_TRANSIT.
	o2, err := lockOrder(ctx, tx, o.ID)
	if err != nil {
		return nil, err
	}
	if o2.State == StateSampleCollected || o2.State == StateInTransit {
		if err := s.transitionTx(ctx, tx, scientistID, o2, StateAccessioned); err != nil {
			return nil, err
		}
		o2.State = StateAccessioned
		if err := s.transitionTx(ctx, tx, scientistID, o2, StateProcessing); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("lab: commit accession: %w", err)
	}
	locked.State = SampleAccessioned
	locked.CustodianID = &scientistID
	s.audited(scientistID, o.PatientID, "health.lab.sample.accession", sampleID,
		map[string]any{"state": string(sm.State)}, map[string]any{"state": string(SampleAccessioned)})
	return locked, nil
}

// ─── Result entry / validation / sign-off & release ─────────────────────────

// EnterResultInput is one validated result line entered by the scientist.
type EnterResultInput struct {
	TestID   string
	Value    string
	Unit     string
	RefRange string
	Status   ResultStatus
}

// EnterResults records scientist-entered, validated results for a PROCESSING order
// and moves it → RESULT_READY (HL-1: the licensed scientist performs the test and
// validates; Paymax only carries workflow). HL-6 backstop: results may only be
// entered when the order's sample is ACCESSIONED (unbroken chain). The clinical
// status flag drives HL-7 — if any line is critical/abnormal the order is taken
// down the ESCALATED path on release, never silently released.
func (s *Service) EnterResults(ctx context.Context, scientistID, orderID, scannedBarcode string, results []EnterResultInput) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.State != StateProcessing {
		return nil, fmt.Errorf("lab: order must be PROCESSING to enter results, is %s", o.State)
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("lab: at least one result required")
	}
	// HL-2: only a verified scientist of this lab may enter/validate results.
	if s.prov != nil {
		ok, perr := s.prov.IsVerifiedScientist(ctx, scientistID, o.LabProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("lab: only a verified lab scientist may enter results (HL-2)")
		}
	}
	// HL-6: no result without an unbroken, accessioned chain of custody.
	sm, err := s.sampleByOrder(ctx, orderID)
	if err != nil || sm == nil {
		return nil, fmt.Errorf("lab: no sample for order — cannot enter results (HL-6)")
	}
	if sm.State != SampleAccessioned {
		return nil, fmt.Errorf("lab: sample not accessioned (state %s) — no result without an unbroken chain (HL-6)", sm.State)
	}
	// LR-001: results bind to the correct sample/patient. If the scientist scanned
	// the tube at result entry, its barcode MUST match this order's sample — a
	// mismatch means results are being entered against the wrong sample; reject.
	if err := verifyBarcodeScan(scannedBarcode, sm.BarcodeRef); err != nil {
		s.audited(scientistID, o.PatientID, "health.lab.result.barcode_mismatch", orderID, nil,
			map[string]any{"scanned": normalizeBarcode(scannedBarcode), "expected": sm.BarcodeRef})
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("lab: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, r := range results {
		if r.Status != ResultNormal && r.Status != ResultAbnormal && r.Status != ResultCritical {
			return nil, fmt.Errorf("lab: result status must be NORMAL, ABNORMAL or CRITICAL")
		}
		var name string
		if err := tx.QueryRow(ctx, `SELECT test_name FROM lab_order_lines WHERE order_id=$1 AND test_id=$2`, orderID, r.TestID).Scan(&name); err != nil {
			if err == pgx.ErrNoRows {
				return nil, fmt.Errorf("lab: result test %s not part of this order", r.TestID)
			}
			return nil, err
		}
		// Fail-safe interpretation backstop (LR-002/003/008, EC-002): reject a
		// wrong-unit value, and UPGRADE a mis-entered status so a critical/abnormal
		// value can never be released as NORMAL. Never downgrades the scientist.
		effStatus, unitMismatch := deriveEffectiveStatus(r.Status, name, r.Value, r.Unit, r.RefRange)
		if unitMismatch {
			return nil, fmt.Errorf("lab: result unit %q for %s disagrees with the reference-range/expected unit (possible transposition) — rejected (EC-002)", r.Unit, name)
		}
		const ins = `
			INSERT INTO lab_results (id, order_id, test_id, test_name, value, unit, ref_range, status, validated_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
		if _, err := tx.Exec(ctx, ins, uuid.New().String(), orderID, r.TestID, name,
			r.Value, r.Unit, r.RefRange, string(effStatus), scientistID); err != nil {
			return nil, fmt.Errorf("lab: insert result: %w", err)
		}
		if effStatus != r.Status {
			// Attributable record that the safety backstop escalated the severity.
			s.audited(scientistID, o.PatientID, "health.lab.result.status_upgraded", orderID,
				map[string]any{"test": name, "entered": string(r.Status)},
				map[string]any{"effective": string(effStatus)})
		}
	}
	o2, err := lockOrder(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	if err := s.transitionTx(ctx, tx, scientistID, o2, StateResultReady); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("lab: commit results: %w", err)
	}
	s.audited(scientistID, o.PatientID, "health.lab.result.enter", orderID,
		map[string]any{"state": string(StateProcessing)}, map[string]any{"state": string(StateResultReady)})
	o.State = StateResultReady
	return o, nil
}

// Release is the scientist sign-off (HL-7) that publishes the result to the
// patient's records vault (HL-8) and releases the held payment to the lab (HL-9).
//
// HL-7: if any validated result is critical/abnormal the order MUST pass through
// ESCALATED first — Release escalates (notify patient + ordering clinician via the
// Notifier, never a silent flag), records the escalation, then proceeds to
// RELEASED. A normal result goes RESULT_READY → RELEASED directly.
//
// HL-8: on RELEASED the authoritative result is written into the records vault as
// a LAB_RESULT record (consent-gated + access-logged + signed-URL on read there);
// the vault record id is pinned onto the order.
func (s *Service) Release(ctx context.Context, scientistID, orderID string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.State != StateResultReady && o.State != StateEscalated {
		return nil, fmt.Errorf("lab: order not ready for release, is %s", o.State)
	}
	// HL-2: only a verified scientist of this lab may sign off and release.
	if s.prov != nil {
		ok, perr := s.prov.IsVerifiedScientist(ctx, scientistID, o.LabProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("lab: only a verified lab scientist may release results (HL-2/HL-7)")
		}
	}

	results, err := s.loadResults(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("lab: no results to release")
	}

	// HL-7: critical/abnormal value → human escalation BEFORE release.
	critical := false
	for _, r := range results {
		if needsEscalation(r.Status) {
			critical = true
			break
		}
	}
	if critical && o.State == StateResultReady {
		// Move to ESCALATED and fire the human escalation (patient + clinician).
		if _, err := s.transition(ctx, scientistID, orderID, StateEscalated, func(tx pgx.Tx, cur *Order) error {
			_, e := tx.Exec(ctx, `UPDATE lab_results SET escalated_at=now() WHERE order_id=$1 AND status IN ('ABNORMAL','CRITICAL') AND escalated_at IS NULL`, orderID)
			return e
		}, "health.lab.result.escalate"); err != nil {
			return nil, err
		}
		if s.notify != nil {
			// Never silent: notify patient + ordering clinician of the critical result.
			if nerr := s.notify.NotifyCriticalResult(ctx, o.PatientID, orderID, "CRITICAL"); nerr != nil {
				// escalation must be recorded even if the channel hiccups; the
				// ESCALATED state + audit entry are the durable record.
				s.audited(scientistID, o.PatientID, "health.lab.result.escalate.notify_failed", orderID, nil,
					map[string]any{"error": nerr.Error()})
			}
		}
		o.State = StateEscalated
	}

	// HL-10: gate the lab payee on KYC before releasing funds.
	payeeID, err := s.labOwner(ctx, o.LabProviderID)
	if err != nil {
		return nil, err
	}
	if s.payout != nil {
		ok, perr := s.payout.PayoutEligible(ctx, payeeID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("lab: lab not payout-eligible — KYC tier required (HL-10)")
		}
	}

	// HL-8: write the authoritative result to the records vault (consent-gated read,
	// access-logged, signed-URL there). The record id is pinned onto the order.
	var recordID *string
	if s.vault != nil {
		body := summariseResults(results)
		rid, verr := s.vault.Create(ctx, o.PatientID, scientistID, "PATIENT", "LAB_RESULT",
			"Laboratory result", body, nil)
		if verr != nil {
			return nil, fmt.Errorf("lab: write result to vault (HL-8): %w", verr)
		}
		recordID = &rid
	}

	out, err := s.transition(ctx, scientistID, orderID, StateReleased, func(tx pgx.Tx, cur *Order) error {
		if _, e := tx.Exec(ctx, `UPDATE lab_orders SET result_record_id=$2 WHERE id=$1`, orderID, recordID); e != nil {
			return e
		}
		_, e := tx.Exec(ctx, `UPDATE lab_results SET released_by=$2, released_at=now() WHERE order_id=$1 AND released_at IS NULL`, orderID, scientistID)
		return e
	}, "health.lab.result.release")
	if err != nil {
		return nil, err
	}

	// HL-9: RELEASE the held amount to the lab payee (idempotent on the hold).
	if o.EscrowID != nil {
		if err := s.escrow.Release(ctx, *o.EscrowID, payeeID); err != nil {
			return nil, fmt.Errorf("lab: release payment (HL-9): %w", err)
		}
	}
	// Terminal CLOSED once funds released (best-effort, idempotent on retry).
	if closed, cerr := s.transition(ctx, scientistID, orderID, StateClosed, nil, "health.lab.order.close"); cerr == nil {
		out = closed
	}
	out.ResultRecordID = recordID
	return out, nil
}

// Cancel moves a pre-collection order → CANCELLED → REFUNDED (HL-9). Only the
// patient who owns the order may cancel, and only before the sample enters the lab
// pipeline. The refund returns the held funds to the payer and is idempotent.
func (s *Service) Cancel(ctx context.Context, patientID, orderID, reason string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.PatientID != patientID {
		return nil, fmt.Errorf("lab: forbidden")
	}
	if !isPreCollection(o.State) {
		return nil, fmt.Errorf("lab: order can only be cancelled before it enters the lab pipeline, is %s", o.State)
	}
	out, err := s.transition(ctx, patientID, orderID, StateCancelled, func(tx pgx.Tx, cur *Order) error {
		_, e := tx.Exec(ctx, `UPDATE lab_orders SET cancel_reason=$2 WHERE id=$1`, orderID, reason)
		return e
	}, "health.lab.order.cancel")
	if err != nil {
		return nil, err
	}
	if o.EscrowID != nil {
		if err := s.escrow.Refund(ctx, *o.EscrowID); err != nil {
			return nil, fmt.Errorf("lab: refund payment (HL-9): %w", err)
		}
	}
	if refunded, rerr := s.transition(ctx, patientID, orderID, StateRefunded, nil, "health.lab.order.refund"); rerr == nil {
		out = refunded
	}
	return out, nil
}

// Get returns an order with object-level authZ: the patient, the owning lab, or an
// admin may read. HL-8: a patient reads only their own order/results.
func (s *Service) Get(ctx context.Context, requesterID, orderID string, isAdmin bool) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	owner, _ := s.labOwner(ctx, o.LabProviderID)
	if !authorizeOrderAccess(requesterID, o.PatientID, owner, isAdmin) {
		return nil, fmt.Errorf("lab: forbidden")
	}
	o.Lines, _ = s.loadLines(ctx, orderID)
	return o, nil
}

// Results returns the validated result lines for an order with object-level authZ
// (HL-8: only the patient, the owning lab, or admin). The authoritative copy lives
// in the vault; this surfaces the structured lines for the in-app viewer.
func (s *Service) Results(ctx context.Context, requesterID, orderID string, isAdmin bool) ([]Result, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	owner, _ := s.labOwner(ctx, o.LabProviderID)
	if !authorizeOrderAccess(requesterID, o.PatientID, owner, isAdmin) {
		return nil, fmt.Errorf("lab: forbidden")
	}
	return s.loadResults(ctx, orderID)
}

// CustodyTrail returns the immutable chain-of-custody log for an order's sample
// (HL-6/HL-12). Object-level authZ: patient / owning lab / admin.
func (s *Service) CustodyTrail(ctx context.Context, requesterID, orderID string, isAdmin bool) ([]CustodyEvent, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	owner, _ := s.labOwner(ctx, o.LabProviderID)
	if !authorizeOrderAccess(requesterID, o.PatientID, owner, isAdmin) {
		return nil, fmt.Errorf("lab: forbidden")
	}
	sm, err := s.sampleByOrder(ctx, orderID)
	if err != nil || sm == nil {
		return nil, nil
	}
	return s.loadCustody(ctx, sm.ID)
}

// ─── internals ──────────────────────────────────────────────────────────────

// transition is a guarded compare-and-set of the order state with an optional
// side effect, all in one tx, plus an immutable audit entry (HL-12).
func (s *Service) transition(ctx context.Context, actorID, orderID string, to OrderState, side func(pgx.Tx, *Order) error, action string) (*Order, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("lab: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	o, err := lockOrder(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	if o.State == to {
		return o, nil // idempotent re-apply
	}
	if !canTransitionOrder(o.State, to) {
		return nil, fmt.Errorf("lab: illegal transition %s -> %s", o.State, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE lab_orders SET state=$2, updated_at=now() WHERE id=$1`, orderID, string(to)); err != nil {
		return nil, fmt.Errorf("lab: update state: %w", err)
	}
	if side != nil {
		if err := side(tx, o); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("lab: commit: %w", err)
	}
	from := o.State
	o.State = to
	s.audited(actorID, o.PatientID, action, orderID,
		map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return o, nil
}

// transitionTx applies a guarded order transition inside an existing tx (used when
// the order transition is part of a larger atomic operation, e.g. accession).
func (s *Service) transitionTx(ctx context.Context, tx pgx.Tx, actorID string, o *Order, to OrderState) error {
	if o.State == to {
		return nil
	}
	if !canTransitionOrder(o.State, to) {
		return fmt.Errorf("lab: illegal transition %s -> %s", o.State, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE lab_orders SET state=$2, updated_at=now() WHERE id=$1`, o.ID, string(to)); err != nil {
		return fmt.Errorf("lab: update state: %w", err)
	}
	from := o.State
	o.State = to
	s.audited(actorID, o.PatientID, "health.lab.order.transition", o.ID,
		map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return nil
}

// transitionSample is a guarded compare-and-set of the sample state + an immutable
// custody event (HL-6/HL-12).
func (s *Service) transitionSample(ctx context.Context, actorID, sampleID string, to SampleState, newCustodian *string, note, action string) (*Sample, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("lab: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	sm, err := lockSample(ctx, tx, sampleID)
	if err != nil {
		return nil, err
	}
	if sm.State == to {
		return sm, nil
	}
	if !canTransitionSample(sm.State, to) {
		return nil, fmt.Errorf("lab: illegal sample transition %s -> %s", sm.State, to)
	}
	custodian := sm.CustodianID
	if newCustodian != nil {
		custodian = newCustodian
	}
	if _, err := tx.Exec(ctx, `UPDATE lab_samples SET state=$2, custodian_id=$3 WHERE id=$1`, sampleID, string(to), custodian); err != nil {
		return nil, fmt.Errorf("lab: update sample: %w", err)
	}
	if err := appendCustody(ctx, tx, sampleID, sm.State, to, actorID, sm.CustodianID, custodian, note); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("lab: commit sample: %w", err)
	}
	from := sm.State
	sm.State = to
	sm.CustodianID = custodian
	s.audited(actorID, "", action, sampleID,
		map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return sm, nil
}

// appendCustody writes one immutable chain-of-custody event (HL-6). Append-only —
// rows are never updated or deleted.
func appendCustody(ctx context.Context, tx pgx.Tx, sampleID string, from, to SampleState, actorID string, fromCustodian, toCustodian *string, note string) error {
	const ins = `
		INSERT INTO lab_custody_events (id, sample_id, from_state, to_state, actor_id, from_custodian, to_custodian, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := tx.Exec(ctx, ins, uuid.New().String(), sampleID, string(from), string(to), actorID, fromCustodian, toCustodian, note)
	if err != nil {
		return fmt.Errorf("lab: append custody event: %w", err)
	}
	return nil
}

func lockOrder(ctx context.Context, tx pgx.Tx, orderID string) (*Order, error) {
	var o Order
	var state, method string
	const q = `SELECT id, patient_id, lab_provider_id, state, collection_method, total_kobo,
	                  escrow_id, delivery_ref, result_record_id, cancel_reason, idempotency_key, created_at
	           FROM lab_orders WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, orderID).Scan(&o.ID, &o.PatientID, &o.LabProviderID, &state, &method,
		&o.TotalKobo, &o.EscrowID, &o.DeliveryRef, &o.ResultRecordID, &o.CancelReason, &o.IdempotencyKey, &o.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("lab: order not found")
		}
		return nil, err
	}
	o.State = OrderState(state)
	o.CollectionMethod = CollectionMethod(method)
	return &o, nil
}

func (s *Service) load(ctx context.Context, orderID string) (*Order, error) {
	var o Order
	var state, method string
	const q = `SELECT id, patient_id, lab_provider_id, state, collection_method, total_kobo,
	                  escrow_id, delivery_ref, result_record_id, cancel_reason, idempotency_key, created_at
	           FROM lab_orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&o.ID, &o.PatientID, &o.LabProviderID, &state, &method,
		&o.TotalKobo, &o.EscrowID, &o.DeliveryRef, &o.ResultRecordID, &o.CancelReason, &o.IdempotencyKey, &o.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("lab: order not found")
		}
		return nil, err
	}
	o.State = OrderState(state)
	o.CollectionMethod = CollectionMethod(method)
	return &o, nil
}

func (s *Service) getByIdem(ctx context.Context, idemKey string) (*Order, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM lab_orders WHERE idempotency_key=$1`, idemKey).Scan(&id); err != nil {
		return nil, err
	}
	o, err := s.load(ctx, id)
	if err != nil {
		return nil, err
	}
	o.Lines, _ = s.loadLines(ctx, id)
	return o, nil
}

func (s *Service) loadLines(ctx context.Context, orderID string) ([]OrderLine, error) {
	const q = `SELECT id, order_id, test_id, test_name, unit_price_kobo FROM lab_order_lines WHERE order_id=$1`
	rows, err := s.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrderLine
	for rows.Next() {
		var l OrderLine
		if err := rows.Scan(&l.ID, &l.OrderID, &l.TestID, &l.TestName, &l.UnitPriceKobo); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}

func lockSample(ctx context.Context, tx pgx.Tx, sampleID string) (*Sample, error) {
	var sm Sample
	var state, method string
	const q = `SELECT id, order_id, state, collection_method, custodian_id, barcode_ref, collected_by, collected_at
	           FROM lab_samples WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, sampleID).Scan(&sm.ID, &sm.OrderID, &state, &method,
		&sm.CustodianID, &sm.BarcodeRef, &sm.CollectedBy, &sm.CollectedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("lab: sample not found")
		}
		return nil, err
	}
	sm.State = SampleState(state)
	sm.CollectionMethod = CollectionMethod(method)
	return &sm, nil
}

func (s *Service) loadSample(ctx context.Context, sampleID string) (*Sample, error) {
	var sm Sample
	var state, method string
	const q = `SELECT id, order_id, state, collection_method, custodian_id, barcode_ref, collected_by, collected_at
	           FROM lab_samples WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, sampleID).Scan(&sm.ID, &sm.OrderID, &state, &method,
		&sm.CustodianID, &sm.BarcodeRef, &sm.CollectedBy, &sm.CollectedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("lab: sample not found")
		}
		return nil, err
	}
	sm.State = SampleState(state)
	sm.CollectionMethod = CollectionMethod(method)
	return &sm, nil
}

func (s *Service) sampleByOrder(ctx context.Context, orderID string) (*Sample, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM lab_samples WHERE order_id=$1 LIMIT 1`, orderID).Scan(&id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return s.loadSample(ctx, id)
}

func (s *Service) loadResults(ctx context.Context, orderID string) ([]Result, error) {
	const q = `SELECT id, order_id, test_id, test_name, value, unit, ref_range, status,
	                  validated_by, released_by, escalated_at, released_at, created_at
	           FROM lab_results WHERE order_id=$1 ORDER BY created_at ASC`
	rows, err := s.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var r Result
		var status string
		if err := rows.Scan(&r.ID, &r.OrderID, &r.TestID, &r.TestName, &r.Value, &r.Unit, &r.RefRange,
			&status, &r.ValidatedBy, &r.ReleasedBy, &r.EscalatedAt, &r.ReleasedAt, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Status = ResultStatus(status)
		out = append(out, r)
	}
	return out, nil
}

func (s *Service) loadCustody(ctx context.Context, sampleID string) ([]CustodyEvent, error) {
	const q = `SELECT id, sample_id, from_state, to_state, actor_id, from_custodian, to_custodian, note, occurred_at
	           FROM lab_custody_events WHERE sample_id=$1 ORDER BY occurred_at ASC`
	rows, err := s.db.Query(ctx, q, sampleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CustodyEvent
	for rows.Next() {
		var e CustodyEvent
		var from, to string
		if err := rows.Scan(&e.ID, &e.SampleID, &from, &to, &e.ActorID, &e.FromCustodian, &e.ToCustodian, &e.Note, &e.OccurredAt); err != nil {
			return nil, err
		}
		e.FromState = SampleState(from)
		e.ToState = SampleState(to)
		out = append(out, e)
	}
	return out, nil
}

// labOwner resolves the owner_user_id of a lab provider (the payout payee + authZ
// subject for the owning lab).
func (s *Service) labOwner(ctx context.Context, providerID string) (string, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT owner_user_id FROM health_providers WHERE id=$1`, providerID).Scan(&owner); err != nil {
		return "", fmt.Errorf("lab: provider not found")
	}
	return owner, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "lab_order", resourceID, oldV, newV, "", "", "info")
}

// summariseResults renders the validated result lines into a minimised vault body
// (HL-8: the structured detail also lives in lab_results; this is the vault copy).
func summariseResults(results []Result) string {
	var b strings.Builder
	for _, r := range results {
		fmt.Fprintf(&b, "%s: %s %s (ref %s) [%s]\n", r.TestName, r.Value, r.Unit, r.RefRange, r.Status)
	}
	return b.String()
}

// generateBarcode mints a sample barcode/accession reference.
func generateBarcode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 10)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			b[i] = alphabet[0]
			continue
		}
		b[i] = alphabet[n.Int64()]
	}
	return "LAB-" + string(b)
}
