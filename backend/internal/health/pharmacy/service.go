package healthpharmacy

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
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

// ReviewCaseOpener — optional symptom-search review-case seam (PRD §10).
// Satisfied by symptomsearch.Service via an app-level adapter; nil is safe
// (symptom-search flag off ⇒ never wired ⇒ existing behavior unchanged).
type ReviewCaseOpener interface {
	OpenReviewCaseForOrder(ctx context.Context, actorID, orderID, pharmacyProviderID string, searchEventID *string, rxRequired bool) error
}

// EscrowHolder is the funds-hold rail (HL-9). Satisfied by internal/escrow.Service.
// Hold debits the payer into the shared escrow account on CREATED; Release credits
// the pharmacy payee on DELIVERED/COLLECTED; Refund returns funds on CANCELLED.
// All three are idempotent on idemKey (escrow enforces replay-safety internally).
type EscrowHolder interface {
	Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error)
	Release(ctx context.Context, escrowID, payeeID string) error
	Refund(ctx context.Context, escrowID string) error
}

// HoldRef is the minimal projection of an escrow hold the order needs.
type HoldRef interface {
	HoldID() string
}

// RxGate is the P0 e-prescription engine (HL-3). REUSE healthrx — POM items
// require a pharmacist-verified e-Rx before fulfilment and dispense-once is
// enforced server-side by healthrx (VERIFIED→DISPENSED guarded transition + the
// partial UNIQUE index in the schema). This package never re-implements dispense
// logic (HL-1) — it drives healthrx through the pharmacist's order action.
type RxGate interface {
	// EnsureVerified reports the prescription is in VERIFIED state and bound to
	// this patient + pharmacy (object-level authZ), returning whether it carries
	// any POM item. Used before CONFIRM of an Rx-required order.
	EnsureVerified(ctx context.Context, requesterID, rxID, patientID, pharmacyProviderID string) error
	// Dispense fills the e-Rx exactly once (HL-3 dispense-once). It delegates to
	// healthrx.Dispense which serialises on FOR UPDATE and is backstopped by the
	// partial UNIQUE index — a prescription can never be filled twice.
	Dispense(ctx context.Context, pharmacistID, rxID string) error
	// Fulfill marks the e-Rx FULFILLED once handed to the delivery/pickup rail.
	Fulfill(ctx context.Context, actorID, rxID string) error
}

// Dispatcher is the transport last-mile rail (REUSE internal/transport). A
// medication delivery is a dispatch job on this existing rail — we never rebuild
// routing. CreateDelivery returns an opaque delivery reference tracked elsewhere.
type Dispatcher interface {
	CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error)
}

// ProviderGate checks HL-2: only a verified (APPROVED + discoverable) pharmacy
// capability may list catalog products and transact. Satisfied by a thin adapter
// over health/providers.
type ProviderGate interface {
	// VerifiedPharmacyOwner reports whether userID owns the given pharmacy
	// provider AND that provider is APPROVED (HL-2 credential-gated supply).
	VerifiedPharmacyOwner(ctx context.Context, userID, providerID string) (bool, error)
	// IsApprovedPharmacy reports whether the provider is an APPROVED pharmacy
	// (used to gate order creation against a live, verified supplier).
	IsApprovedPharmacy(ctx context.Context, providerID string) (bool, error)
}

// PayoutGate checks HL-10: provider payouts require the correct KYC tier. nil is
// treated as "not gated" only in non-payout paths; payout release calls it.
type PayoutGate interface {
	// PayoutEligible reports whether the pharmacy owner meets the KYC tier needed
	// to receive a settlement (HL-10). Satisfied by an adapter over finance/kyc.
	PayoutEligible(ctx context.Context, ownerUserID string) (bool, error)
}

// ProofRecorder is the DP-006 seam for storing and retrieving proof-of-delivery
// records. Nil-safe: when nil, proofs are not stored (delivery completes anyway
// but unverified). Satisfied by a thin repository over pharmacy_delivery_proofs.
type ProofRecorder interface {
	// RecordProof stores an immutable proof-of-delivery record. Returns the stored
	// proof with ID and timestamps filled in.
	RecordProof(ctx context.Context, proof DeliveryProof) (*DeliveryProof, error)
	// GetProofForOrder retrieves the proof-of-delivery for an order (if any).
	// Returns nil, nil if no proof has been recorded yet.
	GetProofForOrder(ctx context.Context, orderID string) (*DeliveryProof, error)
}

// Service is the PharmacyOrder + catalog + Rx-verification engine.
type Service struct {
	db         *pgxpool.Pool
	escrow     EscrowHolder
	rx         RxGate
	dispatch   Dispatcher
	prov       ProviderGate
	payout     PayoutGate
	verifier   RxVerifier
	audit      Auditor
	reviews    ReviewCaseOpener   // optional (nil-safe), injected via SetReviewCaseOpener
	qty        QuantityGate       // optional (nil-safe), injected via SetQuantityGate (PRD §5.5)
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	rxItems    RxItems            // optional; nil ⇒ dispensed-item↔Rx match check is skipped (DP-002)
	proofRec   ProofRecorder      // optional (DP-006); nil ⇒ proofs not stored (delivery still allowed)
	proofVer   ProofVerifier      // optional (DP-006); nil ⇒ proofs recorded but not verified
}

func NewService(db *pgxpool.Pool, escrow EscrowHolder, rx RxGate, verifier RxVerifier, dispatch Dispatcher, prov ProviderGate, payout PayoutGate, audit Auditor) *Service {
	// DP-006: the DB-backed proof recorder is on by default so delivery proofs
	// are always persisted; SetProofRecorder can still override (or nil it) in
	// wiring/tests.
	return &Service{db: db, escrow: escrow, rx: rx, verifier: verifier, dispatch: dispatch, prov: prov, payout: payout, audit: audit,
		proofRec: NewProofRepo(db)}
}

// SetReviewCaseOpener injects the optional symptom-search seam at wiring time.
func (s *Service) SetReviewCaseOpener(r ReviewCaseOpener) { s.reviews = r }

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// pharmacy never imports the commission package at compile time (mirrors the
// transport/doctor seams) — the adapter, which lives in app-wiring, discards the
// returned earning row and surfaces only the error.
//
// This records realized profit ONLY; it never moves money. The pharmacy module's
// own money movements (the order escrow HELD→RELEASE of the patient payment to the
// pharmacy) are unchanged, and the injected recorder is deliberately constructed
// WITHOUT a ledger so RecordFor never re-posts to the ledger (no double count of the
// commission revenue account) — it appends the immutable earning row used by profit
// reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// RxItems is the nil-safe seam that returns the drug identity (NAFDAC reference) +
// prescribed quantity for each item on a verified prescription — the authority the
// dispensed lines are checked against at dispense time (DP-002). Satisfied by a thin
// app-wiring adapter over healthrx (e.g. healthrx.Service.Get(...).Items). When no
// adapter is wired the field is nil and the match check is skipped (dispense still
// requires a verified pharmacy owner + healthrx dispense-once).
type RxItems interface {
	PrescribedItems(ctx context.Context, rxID string) ([]PrescribedItem, error)
}

// SetRxItems injects the prescribed-items seam used by the DP-002 dispense-match
// safety gate (app-wiring, post-construction). Nil disables the check.
func (s *Service) SetRxItems(r RxItems) { s.rxItems = r }

// SetProofRecorder injects the DP-006 proof-of-delivery storage seam (app-wiring,
// post-construction). Nil disables proof storage (delivery completes without recording).
func (s *Service) SetProofRecorder(pr ProofRecorder) { s.proofRec = pr }

// SetProofVerifier injects the optional DP-006 proof verification seam (app-wiring,
// post-construction). Nil disables verification (proofs recorded but VerifiedAt stays nil).
func (s *Service) SetProofVerifier(pv ProofVerifier) { s.proofVer = pv }

// dispensedRxLines returns the Rx-required dispensed lines of an order joined to
// their product's NAFDAC reference — the identity checked against the prescription.
func (s *Service) dispensedRxLines(ctx context.Context, orderID string) ([]DispensedLine, error) {
	const q = `SELECT p.nafdac_ref, ol.quantity, ol.product_name
	           FROM pharmacy_order_lines ol
	           JOIN pharmacy_products p ON p.id = ol.product_id
	           WHERE ol.order_id=$1 AND ol.rx_required = true`
	rows, err := s.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DispensedLine
	for rows.Next() {
		var d DispensedLine
		if err := rows.Scan(&d.NAFDACRef, &d.Quantity, &d.Label); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// recordCommissionSafe records realized Spotlight profit for a completed pharmacy
// order. It is best-effort and MUST NEVER affect the caller's outcome: a nil
// recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the order completion / pharmacy payout. The
// recorded breakdown is resolved server-side from the central rate card; the source
// ref (the order id) doubles as the idempotency key so retries and reconciliation
// sweeps never double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"health.pharmacy", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[health.pharmacy] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// ─── Catalog (HL-5 NAFDAC gating at write) ──────────────────────────────────

// UpsertProduct writes a catalog product. HL-5: an unregistered or banned NAFDAC
// status is REJECTED at write time (not merely hidden) — the product never lands
// in the catalog. HL-4: a controlled item is rejected at write (excluded at MVP).
// HL-2: only the verified pharmacy owner may list products for that pharmacy.
func (s *Service) UpsertProduct(ctx context.Context, ownerID string, p Product) (*Product, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("pharmacy: unauthenticated")
	}
	if s.prov != nil {
		ok, err := s.prov.VerifiedPharmacyOwner(ctx, ownerID, p.PharmacyProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("pharmacy: not a verified pharmacy owner (HL-2)")
		}
	}
	if strings.TrimSpace(p.Name) == "" {
		return nil, fmt.Errorf("pharmacy: product name required")
	}
	if p.PriceKobo <= 0 {
		return nil, fmt.Errorf("pharmacy: price must be positive kobo")
	}
	if p.IsControlled {
		return nil, fmt.Errorf("pharmacy: controlled substances are excluded at MVP (HL-4)")
	}
	// HL-5: NAFDAC write-time rejection. A blank reference or a non-registered
	// status never enters the catalog — this is rejection at write, not hiding.
	if strings.TrimSpace(p.NAFDACRef) == "" {
		return nil, fmt.Errorf("pharmacy: NAFDAC registration reference required (HL-5)")
	}
	status := strings.ToUpper(strings.TrimSpace(p.NAFDACStatus))
	if status == "" {
		status = "REGISTERED"
	}
	if status != "REGISTERED" {
		return nil, fmt.Errorf("pharmacy: product is %s with NAFDAC — only REGISTERED products may be listed (HL-5)", status)
	}
	p.NAFDACStatus = status

	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	const q = `
		INSERT INTO pharmacy_products
			(id, pharmacy_provider_id, name, nafdac_ref, nafdac_status, rx_required, is_controlled, price_kobo, stock_qty, active)
		VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9)
		ON CONFLICT (id) DO UPDATE SET
			name=$3, nafdac_ref=$4, nafdac_status=$5, rx_required=$6, price_kobo=$7, stock_qty=$8, active=$9, updated_at=now()`
	if _, err := s.db.Exec(ctx, q, p.ID, p.PharmacyProviderID, p.Name, p.NAFDACRef, p.NAFDACStatus, p.RxRequired, p.PriceKobo, p.StockQty, p.Active); err != nil {
		return nil, fmt.Errorf("pharmacy: upsert product: %w", err)
	}
	s.audited(ownerID, "", "health.pharmacy.product.upsert", p.ID, nil,
		map[string]any{"nafdac_ref": p.NAFDACRef, "nafdac_status": p.NAFDACStatus, "rx_required": p.RxRequired})
	return &p, nil
}

// ListProducts returns the active, NAFDAC-registered catalog for a pharmacy. The
// catalog only ever contains registered products (HL-5 enforced at write), so the
// read is a plain active filter; the Rx-required flag is surfaced to the client.
func (s *Service) ListProducts(ctx context.Context, pharmacyProviderID, nameQuery string) ([]Product, error) {
	// Each product is owned by a pharmacy — surface that pharmacy's display name
	// (LEFT JOIN health_providers) so the client can show and search by it. Both
	// the pharmacy-id filter and the free-text search are bound parameters, never
	// string-interpolated, so the query is injection-safe.
	nameQuery = strings.TrimSpace(nameQuery)
	var args []any
	where := ""
	if pharmacyProviderID != "" {
		args = append(args, pharmacyProviderID)
		where += fmt.Sprintf(" AND pr.pharmacy_provider_id = $%d", len(args))
	}
	if nameQuery != "" {
		args = append(args, nameQuery)
		// Match either the medicine name or the owning pharmacy's name.
		where += fmt.Sprintf(" AND (pr.name ILIKE '%%'||$%d||'%%' OR hp.display_name ILIKE '%%'||$%d||'%%')", len(args), len(args))
	}
	q := fmt.Sprintf(`
		SELECT pr.id, pr.pharmacy_provider_id, COALESCE(hp.display_name, ''), pr.name, pr.nafdac_ref,
		       pr.nafdac_status, pr.rx_required, pr.is_controlled, pr.price_kobo, pr.stock_qty, pr.active, pr.created_at
		FROM pharmacy_products pr
		LEFT JOIN health_providers hp ON hp.id = pr.pharmacy_provider_id
		WHERE pr.active = true AND pr.nafdac_status = 'REGISTERED'%s
		ORDER BY pr.name ASC LIMIT 200`, where)
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.PharmacyProviderID, &p.PharmacyName, &p.Name, &p.NAFDACRef, &p.NAFDACStatus,
			&p.RxRequired, &p.IsControlled, &p.PriceKobo, &p.StockQty, &p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// GetProduct returns a single active, NAFDAC-registered catalog product with its
// owning pharmacy's display name. Mirrors ListProducts' shape (LEFT JOIN
// health_providers) so the detail screen has the same attribution as the list.
func (s *Service) GetProduct(ctx context.Context, id string) (*Product, error) {
	const q = `
		SELECT pr.id, pr.pharmacy_provider_id, COALESCE(hp.display_name, ''), pr.name, pr.nafdac_ref,
		       pr.nafdac_status, pr.rx_required, pr.is_controlled, pr.price_kobo, pr.stock_qty, pr.active, pr.created_at
		FROM pharmacy_products pr
		LEFT JOIN health_providers hp ON hp.id = pr.pharmacy_provider_id
		WHERE pr.id = $1 AND pr.active = true AND pr.nafdac_status = 'REGISTERED'`
	var p Product
	if err := s.db.QueryRow(ctx, q, id).Scan(&p.ID, &p.PharmacyProviderID, &p.PharmacyName, &p.Name, &p.NAFDACRef,
		&p.NAFDACStatus, &p.RxRequired, &p.IsControlled, &p.PriceKobo, &p.StockQty, &p.Active, &p.CreatedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// ─── Pharmacist Rx verification workflow (HL-3) ─────────────────────────────

// VerifyPrescription is the pharmacist decision delegated to the P0 e-Rx engine
// (HL-3): begin → SENT_TO_PHARMACY→VERIFYING, then approve → VERIFIED, otherwise
// REJECTED. healthrx records verified_by and enforces the guarded transition;
// this method exists only so the pharmacy API surfaces §6
// POST /prescriptions/:id/verify while REUSING healthrx (no re-implementation).
func (s *Service) VerifyPrescription(ctx context.Context, pharmacistID, rxID string, begin, approve bool, reason string) error {
	if s.verifier == nil {
		return fmt.Errorf("pharmacy: rx verifier not configured")
	}
	if begin {
		if err := s.verifier.BeginVerify(ctx, pharmacistID, rxID); err != nil {
			return err
		}
	}
	return s.verifier.Verify(ctx, pharmacistID, rxID, approve, reason)
}

// RxVerifier is the pharmacist-decision slice of healthrx (HL-3). Satisfied by an
// adapter over healthrx.Service (Verify + BeginVerify).
type RxVerifier interface {
	Verify(ctx context.Context, pharmacistID, rxID string, approve bool, reason string) error
	BeginVerify(ctx context.Context, pharmacistID, rxID string) error
}

// ─── PharmacyOrder lifecycle ────────────────────────────────────────────────

// CreateOrderInput is the validated order-creation payload.
type CreateOrderInput struct {
	PharmacyProviderID string
	PrescriptionID     *string
	FulfilmentMethod   FulfilmentMethod
	IdempotencyKey     string
	SearchEventID      *string // optional symptom-search context (PRD §10 review-case tier)
	Lines              []OrderLineInput
}

type OrderLineInput struct {
	ProductID string
	Quantity  int
}

// maxOrderLineQty bounds a single order line. Pharmacy quantities are small by
// nature (rolling-window caps are single digits); the bound exists to keep the
// server-side kobo arithmetic (price * qty, window sums) overflow-proof.
const maxOrderLineQty = 10_000

// CreateOrder builds a PharmacyOrder and HELDs the patient payment on the escrow
// rail (HL-9). The total is computed server-side from current catalog prices in
// kobo (never trusts the client). If any line is Rx-required the order enters
// RX_PENDING_VERIFICATION and a verified e-Rx is required before CONFIRM (HL-3);
// otherwise it is an OTC order. The whole operation is replay-safe on the
// idempotency key (escrow.Hold dedups the money leg, the order row carries a
// UNIQUE idempotency_key).
func (s *Service) CreateOrder(ctx context.Context, patientID string, in CreateOrderInput) (*Order, error) {
	if patientID == "" {
		return nil, fmt.Errorf("pharmacy: unauthenticated")
	}
	if in.IdempotencyKey == "" {
		return nil, fmt.Errorf("pharmacy: idempotency key required (HL-9)")
	}
	if len(in.Lines) == 0 {
		return nil, fmt.Errorf("pharmacy: at least one order line required")
	}
	if in.FulfilmentMethod != FulfilDelivery && in.FulfilmentMethod != FulfilPickup {
		return nil, fmt.Errorf("pharmacy: fulfilment_method must be DELIVERY or PICKUP")
	}
	// Replay: return the existing order for this idempotency key (no double-hold).
	if existing, err := s.getByIdem(ctx, in.IdempotencyKey); err == nil && existing != nil {
		return existing, nil
	}
	// HL-2: order only against a live, verified pharmacy supplier.
	if s.prov != nil {
		ok, err := s.prov.IsApprovedPharmacy(ctx, in.PharmacyProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("pharmacy: supplier is not an approved pharmacy (HL-2)")
		}
	}

	// Price + Rx-flag every line from the catalog (server-side, kobo integers).
	var total int64
	rxRequired := false
	lines := make([]OrderLine, 0, len(in.Lines))
	for _, li := range in.Lines {
		if li.Quantity <= 0 {
			return nil, fmt.Errorf("pharmacy: line quantity must be positive")
		}
		// Upper bound: keeps price_kobo * quantity far from int64 overflow (a
		// crafted huge quantity could otherwise wrap the total to a small
		// positive hold) and keeps the qty-cap window sum arithmetic safe.
		if li.Quantity > maxOrderLineQty {
			return nil, fmt.Errorf("pharmacy: line quantity exceeds the maximum of %d per line", maxOrderLineQty)
		}
		var name, status string
		var price int64
		var lineRx, controlled, active bool
		const pq = `SELECT name, nafdac_status, rx_required, is_controlled, price_kobo, active
		            FROM pharmacy_products WHERE id=$1 AND pharmacy_provider_id=$2`
		if err := s.db.QueryRow(ctx, pq, li.ProductID, in.PharmacyProviderID).Scan(&name, &status, &lineRx, &controlled, &price, &active); err != nil {
			if err == pgx.ErrNoRows {
				return nil, fmt.Errorf("pharmacy: product not found in this pharmacy catalog")
			}
			return nil, err
		}
		// HL-5 / HL-4 defence in depth at order time.
		if status != "REGISTERED" {
			return nil, fmt.Errorf("pharmacy: product not NAFDAC-registered (HL-5)")
		}
		if controlled {
			return nil, fmt.Errorf("pharmacy: controlled substances excluded at MVP (HL-4)")
		}
		if !active {
			return nil, fmt.Errorf("pharmacy: product is not active")
		}
		lineTotal := price * int64(li.Quantity)
		total += lineTotal
		if lineRx {
			rxRequired = true
		}
		lines = append(lines, OrderLine{
			ID: uuid.New().String(), ProductID: li.ProductID, ProductName: name,
			RxRequired: lineRx, Quantity: li.Quantity, UnitPriceKobo: price, LineTotalKobo: lineTotal,
		})
	}
	if total <= 0 {
		return nil, fmt.Errorf("pharmacy: order total must be positive")
	}
	// HL-3: an Rx-required order needs a prescription reference up front.
	if rxRequired && (in.PrescriptionID == nil || *in.PrescriptionID == "") {
		return nil, fmt.Errorf("pharmacy: this order contains Rx-required items and needs a prescription (HL-3)")
	}
	// Symptom-Search PRD §5.5: per-SKU rolling-window quantity caps, enforced
	// server-side and fail-closed BEFORE the escrow hold (no money moves on a
	// capped order). nil gate (flag off) ⇒ no-op; runs after the idempotent
	// replay short-circuit above so replays never re-count themselves.
	if err := s.checkQuantityCaps(ctx, patientID, in.Lines); err != nil {
		return nil, err
	}

	initial := StateCreated
	if rxRequired {
		initial = StateRxPending
	}

	orderID := uuid.New().String()
	ref := "pharmacy:" + orderID

	// HL-9: HELD on CREATED. The escrow debit posts the balanced ledger leg and
	// fails closed on insufficient funds before any order row is written.
	hold, err := s.escrow.Hold(ctx, patientID, ref, "health.pharmacy", in.IdempotencyKey, total)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: hold payment: %w", err)
	}
	escrowID := hold.HoldID()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	const insOrder = `
		INSERT INTO pharmacy_orders
			(id, patient_id, pharmacy_provider_id, prescription_id, state, fulfilment_method, total_kobo, escrow_id, idempotency_key, search_event_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	if _, err := tx.Exec(ctx, insOrder, orderID, patientID, in.PharmacyProviderID, in.PrescriptionID,
		string(initial), string(in.FulfilmentMethod), total, escrowID, in.IdempotencyKey, in.SearchEventID); err != nil {
		return nil, fmt.Errorf("pharmacy: insert order: %w", err)
	}
	const insLine = `
		INSERT INTO pharmacy_order_lines
			(id, order_id, product_id, product_name, rx_required, quantity, unit_price_kobo, line_total_kobo)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	for i := range lines {
		lines[i].OrderID = orderID
		if _, err := tx.Exec(ctx, insLine, lines[i].ID, orderID, lines[i].ProductID, lines[i].ProductName,
			lines[i].RxRequired, lines[i].Quantity, lines[i].UnitPriceKobo, lines[i].LineTotalKobo); err != nil {
			return nil, fmt.Errorf("pharmacy: insert line: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("pharmacy: commit order: %w", err)
	}

	o := &Order{
		ID: orderID, PatientID: patientID, PharmacyProviderID: in.PharmacyProviderID,
		PrescriptionID: in.PrescriptionID, State: initial, FulfilmentMethod: in.FulfilmentMethod,
		TotalKobo: total, EscrowID: &escrowID, SearchEventID: in.SearchEventID,
		IdempotencyKey: in.IdempotencyKey, Lines: lines,
		CreatedAt: time.Now(),
	}
	s.audited(patientID, "", "health.pharmacy.order.create", orderID, nil,
		map[string]any{"state": string(initial), "total_kobo": total, "escrow_id": escrowID, "rx_required": rxRequired})
	s.openReviewCase(ctx, patientID, orderID, in.PharmacyProviderID, in.SearchEventID, rxRequired)
	return o, nil
}

// openReviewCase invokes the optional symptom-search review seam (PRD §10 POM
// gate). nil opener (flag off) ⇒ no-op. Best-effort: the opener is idempotent
// per order and a failure is audited, never blocks the already-held order.
func (s *Service) openReviewCase(ctx context.Context, actorID, orderID, providerID string, searchEventID *string, rxRequired bool) {
	if s.reviews == nil {
		return
	}
	if err := s.reviews.OpenReviewCaseForOrder(ctx, actorID, orderID, providerID, searchEventID, rxRequired); err != nil {
		s.audited(actorID, "", "health.pharmacy.order.review_case_error", orderID, nil, map[string]any{"error": err.Error()})
	}
}

// Confirm moves CREATED|RX_PENDING_VERIFICATION → CONFIRMED. For an Rx-required
// order the pinned e-Rx MUST be VERIFIED first (HL-3) — the verification is the
// P0 healthrx workflow and EnsureVerified is the gate.
func (s *Service) Confirm(ctx context.Context, actorID, orderID string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.State == StateRxPending {
		if o.PrescriptionID == nil {
			return nil, fmt.Errorf("pharmacy: Rx-pending order has no prescription (HL-3)")
		}
		if s.rx != nil {
			if err := s.rx.EnsureVerified(ctx, actorID, *o.PrescriptionID, o.PatientID, o.PharmacyProviderID); err != nil {
				return nil, fmt.Errorf("pharmacy: prescription not verified (HL-3): %w", err)
			}
		}
	}
	return s.transition(ctx, actorID, orderID, StateConfirmed, nil, "health.pharmacy.order.confirm")
}

// Dispense moves CONFIRMED → DISPENSED. This is the licensed pharmacist's clinical
// action (HL-1: Paymax never dispenses). For an Rx-required order it fills the e-Rx
// exactly once via healthrx.Dispense — dispense-once (HL-3) is enforced server-side
// by healthrx (FOR UPDATE guarded transition + partial UNIQUE index), so even
// concurrent dispense attempts serialise and a prescription can never be filled
// twice. A DispenseRecord is written for the immutable audit (HL-12).
func (s *Service) Dispense(ctx context.Context, pharmacistID, orderID string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if s.prov != nil {
		ok, err := s.prov.VerifiedPharmacyOwner(ctx, pharmacistID, o.PharmacyProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("pharmacy: only the verified pharmacy may dispense (HL-2)")
		}
	}
	// DP-002/DP-003: the dispensed Rx-required lines must match the verified
	// prescription — the right drugs (by NAFDAC registration reference) in no more
	// than the prescribed quantity. Checked BEFORE any state change or e-Rx fill so a
	// wrong-drug / over-quantity dispense is blocked with nothing mutated. Fail-closed
	// on any lookup error; skipped only when no prescribed-items adapter is wired.
	if o.PrescriptionID != nil && s.rxItems != nil {
		dispensed, derr := s.dispensedRxLines(ctx, orderID)
		if derr != nil {
			return nil, fmt.Errorf("pharmacy: load dispensed lines (DP-002): %w", derr)
		}
		prescribed, perr := s.rxItems.PrescribedItems(ctx, *o.PrescriptionID)
		if perr != nil {
			return nil, fmt.Errorf("pharmacy: load prescribed items (DP-002): %w", perr)
		}
		if err := VerifyDispenseMatch(dispensed, prescribed); err != nil {
			s.audited(pharmacistID, o.PatientID, "health.pharmacy.dispense.mismatch", orderID, nil,
				map[string]any{"error": err.Error()})
			return nil, err
		}
	}
	// HL-3 dispense-once: delegate to healthrx BEFORE flipping order state so a
	// double-fill is rejected by healthrx and the order never advances on a
	// second attempt.
	if o.PrescriptionID != nil && s.rx != nil {
		if err := s.rx.Dispense(ctx, pharmacistID, *o.PrescriptionID); err != nil {
			return nil, fmt.Errorf("pharmacy: dispense e-Rx (HL-3 dispense-once): %w", err)
		}
	}
	out, err := s.transition(ctx, pharmacistID, orderID, StateDispensed, func(tx pgx.Tx, cur *Order) error {
		const ins = `INSERT INTO dispense_records (id, order_id, prescription_id, pharmacist_id) VALUES ($1,$2,$3,$4)`
		_, e := tx.Exec(ctx, ins, uuid.New().String(), orderID, cur.PrescriptionID, pharmacistID)
		return e
	}, "health.pharmacy.order.dispense")
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Dispatch moves DISPENSED → IN_DELIVERY (delivery) or READY_FOR_PICKUP (pickup).
// For DELIVERY it creates a delivery job on the transport last-mile rail (REUSE —
// we never rebuild routing) and pins the returned delivery reference. For PICKUP
// it mints a one-time pickup code/QR credential the patient presents at counter.
func (s *Service) Dispatch(ctx context.Context, pharmacistID, orderID string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if s.prov != nil {
		ok, err := s.prov.VerifiedPharmacyOwner(ctx, pharmacistID, o.PharmacyProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("pharmacy: only the verified pharmacy may dispatch (HL-2)")
		}
	}
	if o.State != StateDispensed {
		return nil, fmt.Errorf("pharmacy: order must be DISPENSED before dispatch, is %s", o.State)
	}

	to := StateReadyForPickup
	var deliveryRef *string
	pickupCode := generatePickupCode()

	if o.FulfilmentMethod == FulfilDelivery {
		to = StateInDelivery
		if s.dispatch != nil {
			ref, derr := s.dispatch.CreateDelivery(ctx, o.PatientID, "pharmacy:"+orderID, o.IdempotencyKey+":dispatch")
			if derr != nil {
				return nil, fmt.Errorf("pharmacy: create last-mile delivery: %w", derr)
			}
			deliveryRef = &ref
		}
	}

	out, err := s.transition(ctx, pharmacistID, orderID, to, func(tx pgx.Tx, cur *Order) error {
		const upd = `UPDATE pharmacy_orders SET delivery_ref=$2, pickup_code=$3 WHERE id=$1`
		_, e := tx.Exec(ctx, upd, orderID, deliveryRef, pickupCode)
		return e
	}, "health.pharmacy.order.dispatch")
	if err != nil {
		return nil, err
	}
	// e-Rx FULFILLED once handed to the rail (HL-3 lifecycle completeness).
	if o.PrescriptionID != nil && s.rx != nil {
		_ = s.rx.Fulfill(ctx, pharmacistID, *o.PrescriptionID)
	}
	out.DeliveryRef = deliveryRef
	out.PickupCode = &pickupCode
	return out, nil
}

// Complete moves IN_DELIVERY → DELIVERED or READY_FOR_PICKUP → COLLECTED, then
// RELEASES the held payment to the pharmacy payee (HL-9) and finally closes the
// order. Release requires the pharmacy owner to be payout-eligible (HL-10 KYC).
// The release is idempotent on the escrow hold (escrow tolerates re-resolve).
func (s *Service) Complete(ctx context.Context, actorID, orderID, pickupCode string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	var to OrderState
	switch o.State {
	case StateInDelivery:
		to = StateDelivered
	case StateReadyForPickup:
		// pickup requires the one-time code presented at counter.
		if o.PickupCode == nil || pickupCode == "" || *o.PickupCode != pickupCode {
			return nil, fmt.Errorf("pharmacy: pickup code mismatch")
		}
		to = StateCollected
	default:
		return nil, fmt.Errorf("pharmacy: order not ready to complete, is %s", o.State)
	}

	// DP-006: for delivery orders, require proof-of-delivery before DELIVERED transition.
	// Proof is captured by the courier/driver and validated before this call. If a
	// ProofRecorder is wired, store the proof (actorID assumed to be the driver).
	if o.State == StateInDelivery {
		if o.DeliveryRef == nil || *o.DeliveryRef == "" {
			return nil, fmt.Errorf("pharmacy: missing delivery reference (not dispatched)")
		}
		// For MVP, proof is passed via pickupCode (reuse that field as proof OTP).
		// In a real flow, the driver app captures OTP/photo/signature and passes a structured proof.
		// For now, validate that pickupCode is a 6-digit OTP.
		if pickupCode == "" {
			return nil, fmt.Errorf("pharmacy: proof-of-delivery required before delivery completion (DP-006) — %w", ErrProofRequired)
		}
		proof := DeliveryProof{
			OrderID:    orderID,
			ProofType:  ProofOTP,
			ProofData:  pickupCode,
			CapturedBy: actorID,
		}
		if err := ValidateProofOfDelivery(proof); err != nil {
			return nil, fmt.Errorf("pharmacy: invalid delivery proof (DP-006): %w", err)
		}
		// Store the proof if a recorder is wired.
		if s.proofRec != nil {
			stored, serr := s.proofRec.RecordProof(ctx, proof)
			if serr != nil {
				return nil, fmt.Errorf("pharmacy: failed to record delivery proof (DP-006): %w", serr)
			}
			// Optional: verify the proof if a verifier is wired (e.g., check OTP against sent code).
			if s.proofVer != nil && stored != nil {
				verified, verr := s.proofVer.VerifyProof(*stored)
				if verr != nil {
					return nil, fmt.Errorf("pharmacy: proof verification error (DP-006): %w", verr)
				}
				if !verified {
					return nil, fmt.Errorf("pharmacy: proof verification failed — invalid or mismatched (DP-006)")
				}
				// Mark the proof as verified.
				now := time.Now()
				stored.VerifiedAt = &now
			}
		}
	}

	// HL-10: gate the payee on KYC before releasing funds.
	payeeID, err := s.pharmacyOwner(ctx, o.PharmacyProviderID)
	if err != nil {
		return nil, err
	}
	if s.payout != nil {
		ok, perr := s.payout.PayoutEligible(ctx, payeeID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("pharmacy: pharmacy not payout-eligible — KYC tier required (HL-10)")
		}
	}

	out, err := s.transition(ctx, actorID, orderID, to, nil, "health.pharmacy.order.complete")
	if err != nil {
		return nil, err
	}
	// HL-9: RELEASE the held amount to the pharmacy payee.
	if o.EscrowID != nil {
		if err := s.escrow.Release(ctx, *o.EscrowID, payeeID); err != nil {
			return nil, fmt.Errorf("pharmacy: release payment (HL-9): %w", err)
		}
	}
	// Pharmacy-order settlement point: DELIVERED/COLLECTED + escrow release realizes
	// Spotlight's commission on the fulfilled order. Record realized profit into the
	// central Commission & Profit registry — best-effort + idempotent (the order id
	// doubles as source ref + idempotency key, so retries / the CLOSED-retry path
	// never double-count). gross = the full order total the patient paid (the same
	// basis the pharmacy's own escrow split settles on) — this is the VERTICAL's own
	// order settlement, NOT the separate transport delivery leg. A recorder failure
	// is logged and swallowed — it must NEVER fail or reverse the release above. Nil
	// recorder ⇒ no-op (commission feature off).
	patientID := o.PatientID
	s.recordCommissionSafe(ctx, "Health", "Pharmacy", "", o.TotalKobo, orderID, &patientID)
	// Terminal CLOSED once funds released.
	closed, err := s.transition(ctx, actorID, orderID, StateClosed, nil, "health.pharmacy.order.close")
	if err != nil {
		return out, nil // released; closing is best-effort and idempotent on retry
	}
	return closed, nil
}

// Cancel moves a pre-DISPENSED order → CANCELLED → REFUNDED (HL-9). Only the
// patient who owns the order may cancel, and only before dispense. The refund
// returns the held funds to the payer and is idempotent on the escrow hold.
func (s *Service) Cancel(ctx context.Context, patientID, orderID, reason string) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.PatientID != patientID {
		return nil, fmt.Errorf("pharmacy: forbidden")
	}
	if !isPreDispense(o.State) {
		return nil, fmt.Errorf("pharmacy: order can only be cancelled before dispense, is %s", o.State)
	}
	out, err := s.transition(ctx, patientID, orderID, StateCancelled, func(tx pgx.Tx, cur *Order) error {
		_, e := tx.Exec(ctx, `UPDATE pharmacy_orders SET cancel_reason=$2 WHERE id=$1`, orderID, reason)
		return e
	}, "health.pharmacy.order.cancel")
	if err != nil {
		return nil, err
	}
	// HL-9: REFUND the held amount to the original payer.
	if o.EscrowID != nil {
		if err := s.escrow.Refund(ctx, *o.EscrowID); err != nil {
			return nil, fmt.Errorf("pharmacy: refund payment (HL-9): %w", err)
		}
	}
	refunded, err := s.transition(ctx, patientID, orderID, StateRefunded, nil, "health.pharmacy.order.refund")
	if err != nil {
		return out, nil
	}
	return refunded, nil
}

// Get returns an order with object-level authZ: the patient, the owning pharmacy,
// or an admin may read. The pickup code is returned only to the patient.
func (s *Service) Get(ctx context.Context, requesterID, orderID string, isAdmin bool) (*Order, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	owner, _ := s.pharmacyOwner(ctx, o.PharmacyProviderID)
	if !isAdmin && requesterID != o.PatientID && requesterID != owner {
		return nil, fmt.Errorf("pharmacy: forbidden")
	}
	lines, _ := s.loadLines(ctx, orderID)
	o.Lines = lines
	if requesterID != o.PatientID {
		o.PickupCode = nil // counter credential is patient-only
	}
	return o, nil
}

// ─── Multi-pharmacy discovery + ratings (HL-2 gated) ────────────────────────

// DiscoverPharmacies returns APPROVED + discoverable PHARMACY providers (HL-2),
// mirroring healthvet.DiscoverVets: when lat/lng are supplied and sort resolves
// to distance, it ranks by PostGIS distance within radiusM; otherwise it ranks
// by the server-computed rating aggregate or name. avg_rating/rating_count are
// never client-writable — they are read-only projections of pharmacy_reviews
// (kept in sync by the pharmacy_reviews_apply_rating trigger).
func (s *Service) DiscoverPharmacies(ctx context.Context, lat, lng *float64, radiusM float64, sortBy, nameQuery string) ([]PharmacyProfile, error) {
	hasGeo := lat != nil && lng != nil
	sort := resolveSort(hasGeo, sortBy)
	// Optional case-insensitive search on the pharmacy's display name. Bound as a
	// parameter ($N) — never string-interpolated — so it is injection-safe.
	nameQuery = strings.TrimSpace(nameQuery)

	if sort == SortDistance {
		args := []any{*lng, *lat, discoveryRadius(radiusM)}
		nameClause := ""
		if nameQuery != "" {
			args = append(args, nameQuery)
			nameClause = fmt.Sprintf(" AND p.display_name ILIKE '%%'||$%d||'%%'", len(args))
		}
		q := `
			SELECT p.id, p.display_name,
			       COALESCE(pp.address, ''), ST_Y(p.geo::geometry) AS lat, ST_X(p.geo::geometry) AS lng,
			       ST_Distance(p.geo, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS dist,
			       COALESCE(pp.supports_pickup, true), COALESCE(pp.supports_delivery, true),
			       COALESCE(pp.delivery_fee_kobo, 0), COALESCE(pp.avg_rating, 0), COALESCE(pp.rating_count, 0)
			FROM health_providers p
			LEFT JOIN pharmacy_provider_profiles pp ON pp.pharmacy_provider_id = p.id
			WHERE p.domain='PHARMACY' AND p.provider_type='pharmacy' AND p.status='APPROVED'
			  AND p.discoverable = true AND p.geo IS NOT NULL
			  AND ST_DWithin(p.geo, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)` + nameClause + `
			ORDER BY dist ASC
			LIMIT 100`
		rows, err := s.db.Query(ctx, q, args...)
		if err != nil {
			return nil, fmt.Errorf("pharmacy: discover (geo): %w", err)
		}
		defer rows.Close()
		var out []PharmacyProfile
		for rows.Next() {
			var v PharmacyProfile
			var vlat, vlng, dist float64
			if err := rows.Scan(&v.ProviderID, &v.DisplayName, &v.Address, &vlat, &vlng, &dist,
				&v.SupportsPickup, &v.SupportsDelivery, &v.DeliveryFeeKobo, &v.AvgRating, &v.RatingCount); err != nil {
				return nil, err
			}
			v.Lat, v.Lng, v.DistanceM = &vlat, &vlng, &dist
			out = append(out, v)
		}
		return out, nil
	}

	// List branch (no usable coordinates, or an explicit rating/name sort).
	// orderBy is always one of two hardcoded literals below — never built from
	// caller input — so string-building the ORDER BY clause is injection-safe.
	orderBy := "p.display_name ASC"
	if sort == SortRating {
		orderBy = "COALESCE(pp.avg_rating,0) DESC, COALESCE(pp.rating_count,0) DESC, p.display_name ASC"
	}
	var args []any
	nameClause := ""
	if nameQuery != "" {
		args = append(args, nameQuery)
		nameClause = fmt.Sprintf(" AND p.display_name ILIKE '%%'||$%d||'%%'", len(args))
	}
	q := fmt.Sprintf(`
		SELECT p.id, p.display_name, COALESCE(pp.address, ''),
		       COALESCE(pp.supports_pickup, true), COALESCE(pp.supports_delivery, true),
		       COALESCE(pp.delivery_fee_kobo, 0), COALESCE(pp.avg_rating, 0), COALESCE(pp.rating_count, 0)
		FROM health_providers p
		LEFT JOIN pharmacy_provider_profiles pp ON pp.pharmacy_provider_id = p.id
		WHERE p.domain='PHARMACY' AND p.provider_type='pharmacy' AND p.status='APPROVED' AND p.discoverable = true%s
		ORDER BY %s
		LIMIT 100`, nameClause, orderBy)
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: discover (list): %w", err)
	}
	defer rows.Close()
	var out []PharmacyProfile
	for rows.Next() {
		var v PharmacyProfile
		if err := rows.Scan(&v.ProviderID, &v.DisplayName, &v.Address,
			&v.SupportsPickup, &v.SupportsDelivery, &v.DeliveryFeeKobo, &v.AvgRating, &v.RatingCount); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// loadProfile reads a single PHARMACY provider's discovery profile.
// requireDiscoverable gates the public detail endpoint (HL-2); the owner's own
// post-upsert read (via UpsertPharmacyProfile) skips it so a pharmacy pending
// the discoverable toggle can still see its own storefront settings.
func (s *Service) loadProfile(ctx context.Context, providerID string, requireDiscoverable bool) (*PharmacyProfile, error) {
	q := `
		SELECT p.id, p.display_name, COALESCE(pp.address, ''),
		       COALESCE(pp.supports_pickup, true), COALESCE(pp.supports_delivery, true),
		       COALESCE(pp.delivery_fee_kobo, 0), COALESCE(pp.avg_rating, 0), COALESCE(pp.rating_count, 0)
		FROM health_providers p
		LEFT JOIN pharmacy_provider_profiles pp ON pp.pharmacy_provider_id = p.id
		WHERE p.id=$1 AND p.domain='PHARMACY' AND p.provider_type='pharmacy' AND p.status='APPROVED'`
	if requireDiscoverable {
		q += ` AND p.discoverable = true`
	}
	var v PharmacyProfile
	if err := s.db.QueryRow(ctx, q, providerID).Scan(&v.ProviderID, &v.DisplayName, &v.Address,
		&v.SupportsPickup, &v.SupportsDelivery, &v.DeliveryFeeKobo, &v.AvgRating, &v.RatingCount); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("pharmacy: not found")
		}
		return nil, err
	}
	return &v, nil
}

// GetPharmacyProfile returns a single discoverable pharmacy's detail (HL-2).
func (s *Service) GetPharmacyProfile(ctx context.Context, providerID string) (*PharmacyProfile, error) {
	return s.loadProfile(ctx, providerID, true)
}

// UpsertPharmacyProfile lets the verified pharmacy owner (HL-2) set their
// storefront details (address, fulfilment support, delivery fee). Rating
// fields are never accepted here — they are exclusively server-computed from
// pharmacy_reviews via the DB trigger, never client-set.
func (s *Service) UpsertPharmacyProfile(ctx context.Context, ownerID, providerID string, in UpsertPharmacyProfileInput) (*PharmacyProfile, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("pharmacy: unauthenticated")
	}
	if s.prov != nil {
		ok, err := s.prov.VerifiedPharmacyOwner(ctx, ownerID, providerID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("pharmacy: not a verified pharmacy owner (HL-2)")
		}
	}
	if in.DeliveryFeeKobo < 0 {
		return nil, fmt.Errorf("pharmacy: delivery fee must be zero or positive kobo")
	}
	const q = `
		INSERT INTO pharmacy_provider_profiles (pharmacy_provider_id, address, supports_pickup, supports_delivery, delivery_fee_kobo)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (pharmacy_provider_id) DO UPDATE SET
			address=$2, supports_pickup=$3, supports_delivery=$4, delivery_fee_kobo=$5, updated_at=now()`
	if _, err := s.db.Exec(ctx, q, providerID, strings.TrimSpace(in.Address), in.SupportsPickup, in.SupportsDelivery, in.DeliveryFeeKobo); err != nil {
		return nil, fmt.Errorf("pharmacy: upsert profile: %w", err)
	}
	s.audited(ownerID, "", "health.pharmacy.profile.upsert", providerID, nil,
		map[string]any{"supports_pickup": in.SupportsPickup, "supports_delivery": in.SupportsDelivery, "delivery_fee_kobo": in.DeliveryFeeKobo})
	return s.loadProfile(ctx, providerID, false)
}

// SubmitReview records a patient's rating of a completed order (feeds HL-2
// discovery-by-rating). The order must belong to the caller and be in a
// terminal fulfilled state (DELIVERED/COLLECTED/CLOSED) — a review reflects an
// experience that actually happened, not an in-flight order. UNIQUE(order_id)
// is the DB-level backstop: a retried/duplicate submit is rejected, not
// silently double-counted into the rating aggregate.
func (s *Service) SubmitReview(ctx context.Context, patientID, orderID string, rating int, body string) (*PharmacyReview, error) {
	if patientID == "" {
		return nil, fmt.Errorf("pharmacy: unauthenticated")
	}
	if !validRating(rating) {
		return nil, fmt.Errorf("pharmacy: rating must be between 1 and 5")
	}
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.PatientID != patientID {
		return nil, fmt.Errorf("pharmacy: forbidden")
	}
	if !isReviewable(o.State) {
		return nil, fmt.Errorf("pharmacy: order must be completed before it can be reviewed, is %s", o.State)
	}
	body, ok := normalizeReviewBody(body)
	if !ok {
		return nil, fmt.Errorf("pharmacy: review body must be %d characters or fewer", maxReviewBodyLen)
	}
	r := &PharmacyReview{
		ID:                 uuid.New().String(),
		OrderID:            orderID,
		PharmacyProviderID: o.PharmacyProviderID,
		PatientID:          patientID,
		Rating:             rating,
		Body:               body,
		CreatedAt:          time.Now(),
	}
	const q = `
		INSERT INTO pharmacy_reviews (id, order_id, pharmacy_provider_id, patient_id, rating, body)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (order_id) DO NOTHING`
	ct, err := s.db.Exec(ctx, q, r.ID, r.OrderID, r.PharmacyProviderID, r.PatientID, r.Rating, r.Body)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: submit review: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, fmt.Errorf("pharmacy: order has already been reviewed")
	}
	s.audited(patientID, "", "health.pharmacy.review.submit", r.ID, nil,
		map[string]any{"order_id": orderID, "pharmacy_provider_id": o.PharmacyProviderID, "rating": rating})
	return r, nil
}

// ListReviews returns a pharmacy's reviews, most recent first. HL-8: the
// reviewer's identity is never exposed (PatientID is json:"-"); only the
// rating + body + timestamp are public.
func (s *Service) ListReviews(ctx context.Context, providerID string) ([]PharmacyReview, error) {
	const q = `SELECT id, order_id, pharmacy_provider_id, patient_id, rating, body, created_at
	           FROM pharmacy_reviews WHERE pharmacy_provider_id=$1 ORDER BY created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PharmacyReview
	for rows.Next() {
		var r PharmacyReview
		if err := rows.Scan(&r.ID, &r.OrderID, &r.PharmacyProviderID, &r.PatientID, &r.Rating, &r.Body, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// ─── internals ──────────────────────────────────────────────────────────────

func (s *Service) transition(ctx context.Context, actorID, orderID string, to OrderState, side func(pgx.Tx, *Order) error, action string) (*Order, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: begin: %w", err)
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
		return nil, fmt.Errorf("pharmacy: illegal transition %s -> %s", o.State, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE pharmacy_orders SET state=$2, updated_at=now() WHERE id=$1`, orderID, string(to)); err != nil {
		return nil, fmt.Errorf("pharmacy: update state: %w", err)
	}
	if side != nil {
		if err := side(tx, o); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("pharmacy: commit: %w", err)
	}
	from := o.State
	o.State = to
	s.audited(actorID, o.PatientID, action, orderID,
		map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return o, nil
}

func lockOrder(ctx context.Context, tx pgx.Tx, orderID string) (*Order, error) {
	var o Order
	var state, method string
	const q = `SELECT id, patient_id, pharmacy_provider_id, prescription_id, state, fulfilment_method,
	                  total_kobo, escrow_id, delivery_ref, pickup_code, idempotency_key, created_at
	           FROM pharmacy_orders WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, orderID).Scan(&o.ID, &o.PatientID, &o.PharmacyProviderID, &o.PrescriptionID,
		&state, &method, &o.TotalKobo, &o.EscrowID, &o.DeliveryRef, &o.PickupCode, &o.IdempotencyKey, &o.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("pharmacy: order not found")
		}
		return nil, err
	}
	o.State = OrderState(state)
	o.FulfilmentMethod = FulfilmentMethod(method)
	return &o, nil
}

func (s *Service) load(ctx context.Context, orderID string) (*Order, error) {
	var o Order
	var state, method string
	const q = `SELECT id, patient_id, pharmacy_provider_id, prescription_id, state, fulfilment_method,
	                  total_kobo, escrow_id, delivery_ref, pickup_code, idempotency_key, created_at
	           FROM pharmacy_orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&o.ID, &o.PatientID, &o.PharmacyProviderID, &o.PrescriptionID,
		&state, &method, &o.TotalKobo, &o.EscrowID, &o.DeliveryRef, &o.PickupCode, &o.IdempotencyKey, &o.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("pharmacy: order not found")
		}
		return nil, err
	}
	o.State = OrderState(state)
	o.FulfilmentMethod = FulfilmentMethod(method)
	return &o, nil
}

func (s *Service) getByIdem(ctx context.Context, idemKey string) (*Order, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM pharmacy_orders WHERE idempotency_key=$1`, idemKey).Scan(&id); err != nil {
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
	const q = `SELECT id, order_id, product_id, product_name, rx_required, quantity, unit_price_kobo, line_total_kobo
	           FROM pharmacy_order_lines WHERE order_id=$1`
	rows, err := s.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrderLine
	for rows.Next() {
		var l OrderLine
		if err := rows.Scan(&l.ID, &l.OrderID, &l.ProductID, &l.ProductName, &l.RxRequired,
			&l.Quantity, &l.UnitPriceKobo, &l.LineTotalKobo); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}

// pharmacyOwner resolves the owner_user_id of a pharmacy provider (the payout
// payee + dispatch/dispense authZ subject).
func (s *Service) pharmacyOwner(ctx context.Context, providerID string) (string, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT owner_user_id FROM health_providers WHERE id=$1`, providerID).Scan(&owner); err != nil {
		return "", fmt.Errorf("pharmacy: provider not found")
	}
	return owner, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "pharmacy_order", resourceID, oldV, newV, "", "", "info")
}

// generatePickupCode mints a 6-digit one-time pickup credential (QR-encodable).
func generatePickupCode() string {
	const digits = "0123456789"
	b := make([]byte, 6)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		if err != nil {
			b[i] = digits[0]
			continue
		}
		b[i] = digits[n.Int64()]
	}
	return string(b)
}

// ─── Owner order inbox ──────────────────────────────────────────────────────

// maxOwnerOrderPage bounds a client-supplied page size. Without it, `limit` is a
// lever for pulling the whole order table in one request.
const maxOwnerOrderPage = 100
const defaultOwnerOrderPage = 50

// ListForOwner returns orders belonging to the pharmacies this user OWNS, newest
// first, optionally narrowed to one state.
//
// This is the pharmacist's inbox, and until it existed a pharmacy could take
// money (CreateOrder holds the payment) and complete a fulfilment lifecycle —
// confirm → dispense → dispatch → complete — with no way to discover WHICH orders
// were waiting: the only reads were GET /orders/:id, which needs an id you
// already have, and an admin-only list.
//
// Scoping is by ownership, resolved server-side from health_providers; the caller
// never names a pharmacy. An owner with no pharmacies gets an empty list, not
// everyone's orders.
//
// pickup_code is deliberately NOT selected. Service.Get strips it for every
// reader who is not the patient, because it is the credential the patient
// presents at the counter — returning it here would hand the pharmacy the very
// token it is meant to check against.
func (s *Service) ListForOwner(ctx context.Context, ownerID, state string, limit, offset int) ([]Order, error) {
	if limit <= 0 {
		limit = defaultOwnerOrderPage
	}
	if limit > maxOwnerOrderPage {
		limit = maxOwnerOrderPage
	}
	if offset < 0 {
		offset = 0
	}

	// State is bound as a parameter and compared only when non-empty, so an
	// unknown value yields an empty page rather than an error or a wildcard.
	const q = `
		SELECT o.id, o.patient_id, o.pharmacy_provider_id, o.prescription_id, o.state,
		       o.fulfilment_method, o.total_kobo, o.escrow_id, o.delivery_ref,
		       o.idempotency_key, o.created_at
		FROM pharmacy_orders o
		JOIN health_providers hp ON hp.id = o.pharmacy_provider_id
		WHERE hp.owner_user_id = $1
		  AND ($2 = '' OR o.state = $2)
		ORDER BY o.created_at DESC
		LIMIT $3 OFFSET $4`

	rows, err := s.db.Query(ctx, q, ownerID, state, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Non-nil so the handler serialises [] rather than null for an empty inbox.
	out := []Order{}
	for rows.Next() {
		var o Order
		var st, method string
		if err := rows.Scan(&o.ID, &o.PatientID, &o.PharmacyProviderID, &o.PrescriptionID, &st,
			&method, &o.TotalKobo, &o.EscrowID, &o.DeliveryRef, &o.IdempotencyKey, &o.CreatedAt); err != nil {
			return nil, err
		}
		o.State = OrderState(st)
		o.FulfilmentMethod = FulfilmentMethod(method)
		out = append(out, o)
	}
	return out, rows.Err()
}

// EarningsForOwner totals what this owner's pharmacies have been paid and what is
// still held for them.
//
// A pharmacy is paid by escrow RELEASE on completion, straight to the owner's
// wallet — there is no payout-run batching as there is for restaurants. That made
// the money invisible as a BUSINESS figure: the owner saw undifferentiated wallet
// credits with no attribution to orders, and no idea how much was still held.
//
// Amounts come from escrow_holds rather than pharmacy_orders.total_kobo, because
// the hold is the money record: it knows whether funds were released, refunded or
// are still held, which the order's workflow state only implies.
//
// Scoped by ownership, resolved server-side. An owner with no pharmacies gets
// zeros, not the platform's totals.
func (s *Service) EarningsForOwner(ctx context.Context, ownerID string) (*PharmacyEarnings, error) {
	const q = `
		SELECT
		  COALESCE(SUM(eh.amount_kobo) FILTER (WHERE eh.state = 'RELEASED'), 0),
		  COALESCE(SUM(eh.amount_kobo) FILTER (WHERE eh.state = 'HELD'), 0),
		  COUNT(*) FILTER (WHERE eh.state = 'RELEASED')
		FROM pharmacy_orders o
		JOIN health_providers hp ON hp.id = o.pharmacy_provider_id
		JOIN escrow_holds     eh ON eh.id = o.escrow_id
		WHERE hp.owner_user_id = $1`

	var out PharmacyEarnings
	if err := s.db.QueryRow(ctx, q, ownerID).
		Scan(&out.ReleasedKobo, &out.HeldKobo, &out.OrdersPaid); err != nil {
		return nil, fmt.Errorf("pharmacy: earnings: %w", err)
	}
	return &out, nil
}

// ListProductsForOwner returns every product belonging to the pharmacies this
// user OWNS — including the ones customers cannot see.
//
// ListProducts is the CUSTOMER catalogue: it filters to
// `active = true AND nafdac_status = 'REGISTERED'`, which is right for a shopper
// and useless for a merchant. Under it an owner could write a product but never
// read it back once it stopped being sellable: a line taken off sale vanished
// from their own view, with no way to reprice, restock, or reactivate it, and a
// product still awaiting NAFDAC verification was invisible to the person meant to
// chase it.
//
// Managing stock means seeing all of it, so this deliberately applies NO status
// filter. Scoped by ownership, resolved server-side — a rival's pricing and stock
// levels are commercially sensitive, and an owner of nothing gets nothing.
func (s *Service) ListProductsForOwner(ctx context.Context, ownerID string) ([]Product, error) {
	const q = `
		SELECT pr.id, pr.pharmacy_provider_id, COALESCE(hp.display_name, ''), pr.name, pr.nafdac_ref,
		       pr.nafdac_status, pr.rx_required, pr.is_controlled, pr.price_kobo, pr.stock_qty,
		       pr.active, pr.created_at
		FROM pharmacy_products pr
		JOIN health_providers hp ON hp.id = pr.pharmacy_provider_id
		WHERE hp.owner_user_id = $1
		ORDER BY pr.active DESC, pr.name ASC
		LIMIT 500`

	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Non-nil so the handler serialises [] rather than null for an empty shelf.
	out := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.PharmacyProviderID, &p.PharmacyName, &p.Name, &p.NAFDACRef,
			&p.NAFDACStatus, &p.RxRequired, &p.IsControlled, &p.PriceKobo, &p.StockQty,
			&p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
