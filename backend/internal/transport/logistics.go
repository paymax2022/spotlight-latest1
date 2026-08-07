package transport

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ─── Business logistics ──────────────────────────────────────────────────────
//
// Business owner = a Paymax user with a business_accounts row (UNIQUE owner_id).
// Billing modes:
//   - prepaid_wallet: escrow per delivery on create; settle the courier split on
//     proof-of-delivery (dropoff PIN and/or proof_url required).
//   - monthly_invoice: no escrow; the delivery fare accrues to an open invoice on
//     create and is rolled up at delivery time. Admin issues / marks-paid invoices.
//
// Delivery state: created → assigned → picked_up → delivered · (failed/cancelled).
// Batch state:    created → dispatched → in_progress → completed/partially_failed
//                 · (cancelled).

// deliveryTransitions is the guarded delivery state machine.
var deliveryTransitions = map[string]map[string]bool{
	"created":   {"assigned": true, "cancelled": true},
	"assigned":  {"picked_up": true, "failed": true, "cancelled": true},
	"picked_up": {"delivered": true, "failed": true},
}

func canTransitionDelivery(from, to string) bool {
	if from == to {
		return false
	}
	m, ok := deliveryTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

// deliverySizeMultiplier scales fare by declared parcel size.
func deliverySizeMultiplier(size string) float64 {
	switch size {
	case "medium":
		return 1.4
	case "large":
		return 2.0
	default: // small
		return 1.0
	}
}

// businessAccountRow is the internal projection of a business account.
type businessAccountRow struct {
	ID          string
	OwnerID     string
	Name        string
	AccountType string
	BillingMode string
	CODEnabled  bool
	Status      string
}

// businessDeliveryRow is the internal projection of a delivery.
type businessDeliveryRow struct {
	ID           string
	BatchID      *string
	BusinessID   string
	CourierID    *string
	Status       string
	FareKobo     int64
	CODKobo      int64
	DropoffPin   *string
	SettlementID *string
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// BusinessAccountRequest is POST /mobility/business/accounts.
type BusinessAccountRequest struct {
	Name        string `json:"name" binding:"required,min=2,max=200"`
	AccountType string `json:"account_type"`
	BillingMode string `json:"billing_mode"`
	CODEnabled  bool   `json:"cod_enabled"`
}

// DeliveryStop is one delivery within a single request or a batch.
type DeliveryStop struct {
	Pickup        Place  `json:"pickup" binding:"required"`
	Dropoff       Place  `json:"dropoff" binding:"required"`
	ReceiverName  string `json:"receiver_name" binding:"required"`
	ReceiverPhone string `json:"receiver_phone" binding:"required"`
	Size          string `json:"size"`
	CODKobo       int64  `json:"cod_kobo"`
}

// BusinessDeliveryRequest is POST /mobility/business/deliveries.
type BusinessDeliveryRequest struct {
	Pickup         Place  `json:"pickup" binding:"required"`
	Dropoff        Place  `json:"dropoff" binding:"required"`
	ReceiverName   string `json:"receiver_name" binding:"required"`
	ReceiverPhone  string `json:"receiver_phone" binding:"required"`
	Size           string `json:"size"`
	CODKobo        int64  `json:"cod_kobo"`
	IdempotencyKey string `json:"idempotency_key"`
}

// BusinessBatchRequest is POST /mobility/business/batches.
type BusinessBatchRequest struct {
	Name           string         `json:"name" binding:"required"`
	Deliveries     []DeliveryStop `json:"deliveries" binding:"required,min=1"`
	IdempotencyKey string         `json:"idempotency_key"`
}

// DeliverRequest is POST /driver/business/:id/deliver.
type DeliverRequest struct {
	DropoffPin string `json:"dropoff_pin"`
	ProofURL   string `json:"proof_url" binding:"required"`
}

// FailRequest is POST /driver/business/:id/fail.
type FailRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// deliveryFare computes a delivery fare from distance × duration × size, floored.
func deliveryFare(distanceM, durationS int, size string, cfg *PricingConfig) int64 {
	raw := SystemFare(distanceM, durationS, cfg)
	scaled := int64(float64(raw) * deliverySizeMultiplier(size))
	if scaled < cfg.MinFareKobo {
		scaled = cfg.MinFareKobo
	}
	return scaled
}

// businessForOwner loads the caller's own business account (object-level authz).
func (s *Service) businessForOwner(ctx context.Context, ownerID string) (*businessAccountRow, error) {
	var b businessAccountRow
	const q = `SELECT id, owner_id, name, account_type, billing_mode, cod_enabled, status
	           FROM business_accounts WHERE owner_id=$1`
	if err := s.db.QueryRow(ctx, q, ownerID).Scan(
		&b.ID, &b.OwnerID, &b.Name, &b.AccountType, &b.BillingMode, &b.CODEnabled, &b.Status,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "no business account for this user")
	}
	return &b, nil
}

// openInvoiceID returns the current open invoice for a business, creating one for
// the calendar month if none exists. Used to accrue monthly_invoice deliveries.
func (s *Service) openInvoiceID(ctx context.Context, businessID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx,
		`SELECT id FROM business_invoices WHERE business_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1`,
		businessID).Scan(&id)
	if err == nil {
		return id, nil
	}
	now := time.Now().UTC()
	periodStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	periodEnd := periodStart.AddDate(0, 1, -1)
	id = uuid.New().String()
	if _, err := s.db.Exec(ctx,
		`INSERT INTO business_invoices (id, business_id, period_start, period_end, delivery_count, total_kobo, status)
		 VALUES ($1,$2,$3,$4,0,0,'open')`,
		id, businessID, periodStart, periodEnd); err != nil {
		return "", err
	}
	return id, nil
}

// accrueInvoice adds a delivery fare to the business's open invoice.
func (s *Service) accrueInvoice(ctx context.Context, businessID string, fareKobo int64) error {
	invID, err := s.openInvoiceID(ctx, businessID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx,
		`UPDATE business_invoices SET delivery_count=delivery_count+1, total_kobo=total_kobo+$2 WHERE id=$1`,
		invID, fareKobo)
	return err
}

// ─── Business account ────────────────────────────────────────────────────────

// CreateBusinessAccount registers a business account for the owner (one per user).
func (s *Service) CreateBusinessAccount(ctx context.Context, ownerID string, req BusinessAccountRequest) (map[string]any, error) {
	accountType := req.AccountType
	if accountType == "" {
		accountType = "sme"
	}
	billingMode := req.BillingMode
	if billingMode == "" {
		billingMode = "prepaid_wallet"
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO business_accounts (id, owner_id, name, account_type, billing_mode, cod_enabled, status)
		VALUES ($1,$2,$3,$4,$5,$6,'active')`
	if _, err := s.db.Exec(ctx, q, id, ownerID, req.Name, accountType, billingMode, req.CODEnabled); err != nil {
		// UNIQUE(owner_id) → one account per user.
		return nil, codedErr(http.StatusConflict, "ACCOUNT_EXISTS", "business account already exists for this user")
	}
	s.recordModeEvent(ctx, ownerID, "business.account_created", "business_account", id, "", "active",
		map[string]any{"billing_mode": billingMode, "account_type": accountType})
	return s.BusinessAccountMe(ctx, ownerID)
}

// BusinessAccountMe returns the owner's business account.
func (s *Service) BusinessAccountMe(ctx context.Context, ownerID string) (map[string]any, error) {
	b, err := s.businessForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": b.ID, "ownerId": b.OwnerID, "name": b.Name, "accountType": b.AccountType,
		"billingMode": b.BillingMode, "codEnabled": b.CODEnabled, "status": b.Status,
	}, nil
}

// ─── Single delivery ─────────────────────────────────────────────────────────

// insertDelivery inserts one delivery row and applies the billing-mode rule:
// prepaid_wallet → escrow (caller passes idemKey); monthly_invoice → accrue.
// Returns the new delivery id.
func (s *Service) insertDelivery(ctx context.Context, b *businessAccountRow, stop DeliveryStop, batchID *string, sequence int, idempotencyKey string) (string, error) {
	if stop.CODKobo > 0 && !b.CODEnabled {
		return "", codedErr(http.StatusUnprocessableEntity, "COD_DISABLED", "cash-on-delivery not enabled for this account")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", "business_logistics")
	if err != nil {
		return "", err
	}
	route, err := s.maps.Route(ctx,
		LatLng{Lat: stop.Pickup.Lat, Lng: stop.Pickup.Lng},
		LatLng{Lat: stop.Dropoff.Lat, Lng: stop.Dropoff.Lng},
	)
	if err != nil {
		return "", err
	}
	size := stop.Size
	if size == "" {
		size = "small"
	}
	fare := deliveryFare(route.DistanceM, route.DurationS, size, cfg)

	deliveryID := uuid.New().String()
	dropoffPin := generatePin()

	var settlementID any
	if b.BillingMode == "prepaid_wallet" {
		if idempotencyKey == "" {
			return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
		}
		// Fail-closed tier/spending-limit gate BEFORE the prepaid-wallet escrow (same
		// contract as RequestRide). The monthly_invoice path below accrues (no escrow,
		// no wallet debit) and is intentionally NOT gated here — it is billed via the
		// admin invoice cycle, not a per-delivery wallet move.
		if err := s.enforceTierLimit(ctx, b.OwnerID, fare); err != nil {
			return "", err
		}
		ref := "business_logistics:" + deliveryID
		sett, err := s.settlement.Escrow(ctx, b.OwnerID, ref, idempotencyKey, "transport", fare)
		if err != nil {
			return "", fmt.Errorf("transport: escrow delivery fare: %w", err)
		}
		settlementID = sett.ID
	}

	const q = `
		INSERT INTO business_deliveries
			(id, batch_id, business_id, sequence, pickup_address, pickup_lat, pickup_lng,
			 dropoff_address, dropoff_lat, dropoff_lng, receiver_name, receiver_phone, parcel_size,
			 cod_kobo, fare_kobo, status, dropoff_pin, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'created',$16,$17,$18)`
	if _, err := s.db.Exec(ctx, q,
		deliveryID, batchID, b.ID, sequence, stop.Pickup.Address, stop.Pickup.Lat, stop.Pickup.Lng,
		stop.Dropoff.Address, stop.Dropoff.Lat, stop.Dropoff.Lng, stop.ReceiverName, stop.ReceiverPhone, size,
		stop.CODKobo, fare, dropoffPin, settlementID, nullStr(idempotencyKey),
	); err != nil {
		if settlementID != nil {
			s.settlement.Refund(ctx, settlementID.(string), "delivery_insert_failed")
		}
		return "", fmt.Errorf("transport: insert delivery: %w", err)
	}

	if b.BillingMode == "monthly_invoice" {
		if err := s.accrueInvoice(ctx, b.ID, fare); err != nil {
			return "", fmt.Errorf("transport: accrue invoice: %w", err)
		}
	}
	return deliveryID, nil
}

// CreateDelivery creates a single delivery for the owner's business.
func (s *Service) CreateDelivery(ctx context.Context, ownerID string, req BusinessDeliveryRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	b, err := s.businessForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	if b.Status != "active" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "business account not active")
	}
	stop := DeliveryStop{
		Pickup: req.Pickup, Dropoff: req.Dropoff,
		ReceiverName: req.ReceiverName, ReceiverPhone: req.ReceiverPhone,
		Size: req.Size, CODKobo: req.CODKobo,
	}
	id, err := s.insertDelivery(ctx, b, stop, nil, 1, idempotencyKey)
	if err != nil {
		return nil, err
	}
	s.recordModeEvent(ctx, ownerID, "business.delivery_created", "business_delivery", id, "", "created",
		map[string]any{"business_id": b.ID, "billing_mode": b.BillingMode})
	return s.DeliveryDetail(ctx, id, ownerID)
}

// CreateBatch creates a batch + N deliveries for the owner's business.
func (s *Service) CreateBatch(ctx context.Context, ownerID string, req BusinessBatchRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	b, err := s.businessForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	if b.Status != "active" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "business account not active")
	}
	if len(req.Deliveries) == 0 {
		return nil, codedErr(http.StatusBadRequest, "EMPTY_BATCH", "batch must contain at least one delivery")
	}

	batchID := uuid.New().String()
	if _, err := s.db.Exec(ctx,
		`INSERT INTO delivery_batches (id, business_id, name, total_stops, status) VALUES ($1,$2,$3,$4,'created')`,
		batchID, b.ID, req.Name, len(req.Deliveries)); err != nil {
		return nil, fmt.Errorf("transport: insert batch: %w", err)
	}

	for i, stop := range req.Deliveries {
		// Per-stop idempotency derived from the batch key so each escrow is unique.
		stopKey := ""
		if idempotencyKey != "" {
			stopKey = fmt.Sprintf("%s:%d", idempotencyKey, i+1)
		}
		if _, err := s.insertDelivery(ctx, b, stop, &batchID, i+1, stopKey); err != nil {
			return nil, err
		}
	}
	s.recordModeEvent(ctx, ownerID, "business.batch_created", "delivery_batch", batchID, "", "created",
		map[string]any{"business_id": b.ID, "total_stops": len(req.Deliveries)})
	return s.BatchDetail(ctx, batchID, ownerID)
}

// ─── Reads (owner-scoped) ────────────────────────────────────────────────────

// DeliveryDetail returns a delivery; owner sees PIN, assigned courier does not.
func (s *Service) DeliveryDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, batch_id, business_id, courier_id, sequence, pickup_address, dropoff_address,
		       receiver_name, receiver_phone, parcel_size, cod_kobo, fare_kobo, status,
		       failure_reason, dropoff_pin, proof_url, created_at
		FROM business_deliveries WHERE id=$1`
	var (
		did, businessID, pickup, dropoff, receiver, rphone, size, status string
		batchID, courierID, failure, dropoffPin, proofURL                *string
		sequence                                                         int
		cod, fare                                                        int64
		createdAt                                                        time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&did, &batchID, &businessID, &courierID, &sequence, &pickup, &dropoff,
		&receiver, &rphone, &size, &cod, &fare, &status,
		&failure, &dropoffPin, &proofURL, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "delivery not found")
	}
	// Object-level authz: business owner, or the assigned courier (via driver user_id).
	isOwner, err := s.ownsBusiness(ctx, businessID, callerID)
	if err != nil {
		return nil, err
	}
	if !isOwner {
		if courierID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *courierID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	out := map[string]any{
		"id": did, "batchId": batchID, "businessId": businessID, "courierId": courierID,
		"sequence": sequence, "pickupAddress": pickup, "dropoffAddress": dropoff,
		"receiverName": receiver, "receiverPhone": rphone, "parcelSize": size,
		"codKobo": cod, "fareKobo": fare, "status": status, "failureReason": failure,
		"proofUrl": proofURL, "createdAt": createdAt,
	}
	// Only the owner may read the dropoff PIN (the courier verifies, never reads).
	if isOwner {
		out["dropoffPin"] = dropoffPin
	}
	return out, nil
}

// ownsBusiness reports whether userID owns the given business account.
func (s *Service) ownsBusiness(ctx context.Context, businessID, userID string) (bool, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT owner_id FROM business_accounts WHERE id=$1`, businessID).Scan(&owner); err != nil {
		return false, codedErr(http.StatusNotFound, CodeNotFound, "business account not found")
	}
	return owner == userID, nil
}

// ListDeliveries returns the owner's deliveries, optionally filtered by status.
func (s *Service) ListDeliveries(ctx context.Context, ownerID, status string) ([]map[string]any, error) {
	b, err := s.businessForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	q := `SELECT id, batch_id, courier_id, sequence, dropoff_address, parcel_size, cod_kobo, fare_kobo, status, created_at
	      FROM business_deliveries WHERE business_id=$1`
	args := []any{b.ID}
	if status != "" {
		q += ` AND status=$2`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, dropoff, size, st string
		var batchID, courierID *string
		var sequence int
		var cod, fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &batchID, &courierID, &sequence, &dropoff, &size, &cod, &fare, &st, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "batchId": batchID, "courierId": courierID, "sequence": sequence,
			"dropoffAddress": dropoff, "parcelSize": size, "codKobo": cod,
			"fareKobo": fare, "status": st, "createdAt": createdAt,
		})
	}
	return out, nil
}

// ListBatches returns the owner's batches.
func (s *Service) ListBatches(ctx context.Context, ownerID string) ([]map[string]any, error) {
	b, err := s.businessForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx,
		`SELECT id, name, total_stops, status, created_at FROM delivery_batches WHERE business_id=$1 ORDER BY created_at DESC LIMIT 200`,
		b.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, name, st string
		var totalStops int
		var createdAt time.Time
		if err := rows.Scan(&id, &name, &totalStops, &st, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "name": name, "totalStops": totalStops, "status": st, "createdAt": createdAt,
		})
	}
	return out, nil
}

// BatchDetail returns a batch with its delivery stops (owner only).
func (s *Service) BatchDetail(ctx context.Context, id, ownerID string) (map[string]any, error) {
	var businessID, name, status string
	var totalStops int
	var createdAt time.Time
	if err := s.db.QueryRow(ctx,
		`SELECT business_id, name, total_stops, status, created_at FROM delivery_batches WHERE id=$1`, id).
		Scan(&businessID, &name, &totalStops, &status, &createdAt); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "batch not found")
	}
	isOwner, err := s.ownsBusiness(ctx, businessID, ownerID)
	if err != nil {
		return nil, err
	}
	if !isOwner {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your batch")
	}
	rows, err := s.db.Query(ctx,
		`SELECT id, courier_id, sequence, dropoff_address, parcel_size, fare_kobo, status
		 FROM business_deliveries WHERE batch_id=$1 ORDER BY sequence`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stops []map[string]any
	for rows.Next() {
		var sid, dropoff, size, st string
		var courierID *string
		var sequence int
		var fare int64
		if err := rows.Scan(&sid, &courierID, &sequence, &dropoff, &size, &fare, &st); err != nil {
			return nil, err
		}
		stops = append(stops, map[string]any{
			"id": sid, "courierId": courierID, "sequence": sequence,
			"dropoffAddress": dropoff, "parcelSize": size, "fareKobo": fare, "status": st,
		})
	}
	return map[string]any{
		"id": id, "businessId": businessID, "name": name, "totalStops": totalStops,
		"status": status, "createdAt": createdAt, "stops": stops,
	}, nil
}

// ListInvoices returns the owner's invoices.
func (s *Service) ListInvoices(ctx context.Context, ownerID string) ([]map[string]any, error) {
	b, err := s.businessForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx,
		`SELECT id, period_start, period_end, delivery_count, total_kobo, status, created_at
		 FROM business_invoices WHERE business_id=$1 ORDER BY created_at DESC LIMIT 200`, b.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, st string
		var periodStart, periodEnd, createdAt time.Time
		var count int
		var total int64
		if err := rows.Scan(&id, &periodStart, &periodEnd, &count, &total, &st, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "periodStart": periodStart, "periodEnd": periodEnd,
			"deliveryCount": count, "totalKobo": total, "status": st, "createdAt": createdAt,
		})
	}
	return out, nil
}

// BusinessAnalytics returns delivery counts, success rate, and COD totals.
func (s *Service) BusinessAnalytics(ctx context.Context, ownerID string) (map[string]any, error) {
	b, err := s.businessForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	var total, delivered, failed, cancelled int
	var codDelivered, fareDelivered int64
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM business_deliveries WHERE business_id=$1`, b.ID).Scan(&total)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM business_deliveries WHERE business_id=$1 AND status='delivered'`, b.ID).Scan(&delivered)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM business_deliveries WHERE business_id=$1 AND status='failed'`, b.ID).Scan(&failed)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM business_deliveries WHERE business_id=$1 AND status='cancelled'`, b.ID).Scan(&cancelled)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(cod_kobo),0) FROM business_deliveries WHERE business_id=$1 AND status='delivered'`, b.ID).Scan(&codDelivered)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(fare_kobo),0) FROM business_deliveries WHERE business_id=$1 AND status='delivered'`, b.ID).Scan(&fareDelivered)
	successRate := 0.0
	if total > 0 {
		successRate = float64(delivered) / float64(total)
	}
	return map[string]any{
		"businessId":        b.ID,
		"totalDeliveries":   total,
		"delivered":         delivered,
		"failed":            failed,
		"cancelled":         cancelled,
		"successRate":       successRate,
		"codCollectedKobo":  codDelivered,
		"fareDeliveredKobo": fareDelivered,
	}, nil
}

// ─── Cancel (owner) ──────────────────────────────────────────────────────────

// CancelDelivery refunds escrow (prepaid) or voids accrual (invoice), then
// moves the delivery to cancelled. Owner only.
func (s *Service) CancelDelivery(ctx context.Context, id, ownerID, reason string) error {
	d, err := s.loadDelivery(ctx, id)
	if err != nil {
		return err
	}
	isOwner, err := s.ownsBusiness(ctx, d.BusinessID, ownerID)
	if err != nil {
		return err
	}
	if !isOwner {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your delivery")
	}
	if !canTransitionDelivery(d.Status, "cancelled") {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot cancel from status %s", d.Status))
	}
	if err := s.deliverySetStatus(ctx, id, d.Status, "cancelled"); err != nil {
		return err
	}
	// Refund escrow (prepaid). For monthly_invoice, void the accrued fare.
	if d.SettlementID != nil {
		s.settlement.Refund(ctx, *d.SettlementID, "delivery_cancelled:"+reason)
	} else {
		s.voidAccrual(ctx, d.BusinessID, d.FareKobo)
	}
	if d.CourierID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *d.CourierID)
	}
	s.recordModeEvent(ctx, ownerID, "business.delivery_cancelled", "business_delivery", id, d.Status, "cancelled",
		map[string]any{"reason": reason})
	return nil
}

// voidAccrual reverses an accrued fare on the open invoice (best-effort).
func (s *Service) voidAccrual(ctx context.Context, businessID string, fareKobo int64) {
	s.db.Exec(ctx,
		`UPDATE business_invoices SET delivery_count=GREATEST(delivery_count-1,0), total_kobo=GREATEST(total_kobo-$2,0)
		 WHERE business_id=$1 AND status='open'`,
		businessID, fareKobo)
}

// loadDelivery loads a delivery's mutable projection.
func (s *Service) loadDelivery(ctx context.Context, id string) (*businessDeliveryRow, error) {
	var d businessDeliveryRow
	const q = `SELECT id, batch_id, business_id, courier_id, status, fare_kobo, cod_kobo, dropoff_pin, settlement_id
	           FROM business_deliveries WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&d.ID, &d.BatchID, &d.BusinessID, &d.CourierID, &d.Status, &d.FareKobo, &d.CODKobo, &d.DropoffPin, &d.SettlementID,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "delivery not found")
	}
	return &d, nil
}

// deliverySetStatus performs a guarded status update (rejects illegal transitions).
func (s *Service) deliverySetStatus(ctx context.Context, id, from, to string) error {
	if !canTransitionDelivery(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal delivery transition %s → %s", from, to))
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE business_deliveries SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "delivery status changed concurrently")
	}
	return nil
}

// ─── Courier (driver) flows ──────────────────────────────────────────────────

// OpenDeliveryRequests returns unassigned, created deliveries for couriers.
func (s *Service) OpenDeliveryRequests(ctx context.Context, driverUserID string) ([]map[string]any, error) {
	if _, err := s.driverGate(ctx, driverUserID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, business_id, pickup_address, dropoff_address, parcel_size, cod_kobo, fare_kobo, created_at
		FROM business_deliveries WHERE courier_id IS NULL AND status='created' ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, businessID, pickup, dropoff, size string
		var cod, fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &businessID, &pickup, &dropoff, &size, &cod, &fare, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "businessId": businessID, "pickupAddress": pickup, "dropoffAddress": dropoff,
			"parcelSize": size, "codKobo": cod, "fareKobo": fare, "createdAt": createdAt,
		})
	}
	return out, nil
}

// AcceptDelivery assigns an approved courier to a created delivery. When the
// first stop of a batch is accepted, the batch advances to dispatched/in_progress.
func (s *Service) AcceptDelivery(ctx context.Context, id, driverUserID string) (map[string]any, error) {
	courierID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	d, err := s.loadDelivery(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.Status != "created" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "delivery not open for acceptance")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE business_deliveries SET courier_id=$1, status='assigned', updated_at=NOW()
		 WHERE id=$2 AND courier_id IS NULL AND status='created'`,
		courierID, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "delivery already taken")
	}
	s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, courierID)
	if d.BatchID != nil {
		s.advanceBatchOnDispatch(ctx, *d.BatchID)
	}
	s.recordModeEvent(ctx, driverUserID, "business.delivery_assigned", "business_delivery", id, "created", "assigned",
		map[string]any{"courier_id": courierID})
	return s.DeliveryDetail(ctx, id, driverUserID)
}

// advanceBatchOnDispatch moves a batch created → dispatched → in_progress once a
// stop is picked up by a courier (best-effort, idempotent).
func (s *Service) advanceBatchOnDispatch(ctx context.Context, batchID string) {
	s.db.Exec(ctx, `UPDATE delivery_batches SET status='dispatched' WHERE id=$1 AND status='created'`, batchID)
}

// MarkDeliveryPickedUp: assigned → picked_up (courier only).
func (s *Service) MarkDeliveryPickedUp(ctx context.Context, id, driverUserID string) error {
	d, err := s.courierOwnedDelivery(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if d.Status != "assigned" {
		return codedErr(http.StatusConflict, CodeInvalidState, "delivery not awaiting pickup")
	}
	if err := s.deliverySetStatus(ctx, id, "assigned", "picked_up"); err != nil {
		return err
	}
	if d.BatchID != nil {
		s.db.Exec(ctx, `UPDATE delivery_batches SET status='in_progress' WHERE id=$1 AND status IN ('created','dispatched')`, *d.BatchID)
	}
	s.recordModeEvent(ctx, driverUserID, "business.delivery_picked_up", "business_delivery", id, "assigned", "picked_up", nil)
	return nil
}

// DeliverDelivery: picked_up → delivered with proof (and dropoff PIN if set).
// Settles the courier split on prepaid; for monthly_invoice the fare was accrued
// at create time (no escrow), so delivery just marks the row delivered.
func (s *Service) DeliverDelivery(ctx context.Context, id, driverUserID, dropoffPin, proofURL string) error {
	d, err := s.courierOwnedDelivery(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if d.Status != "picked_up" {
		return codedErr(http.StatusConflict, CodeInvalidState, "delivery not in transit")
	}
	if proofURL == "" {
		return codedErr(http.StatusUnprocessableEntity, "PROOF_REQUIRED", "proof of delivery required")
	}
	// If the delivery carries a dropoff PIN it must be presented and match.
	if d.DropoffPin != nil && *d.DropoffPin != "" {
		if dropoffPin == "" || dropoffPin != *d.DropoffPin {
			return codedErr(http.StatusUnprocessableEntity, CodePinMismatch, "dropoff PIN does not match")
		}
	}
	if err := s.deliverySetStatus(ctx, id, "picked_up", "delivered"); err != nil {
		return err
	}
	s.db.Exec(ctx, `UPDATE business_deliveries SET proof_url=$1, updated_at=NOW() WHERE id=$2`, proofURL, id)

	// Settle the courier split on prepaid escrow. Invoice-billed deliveries accrue
	// (no per-delivery escrow), so settlement happens at invoice close.
	if d.SettlementID != nil && d.CourierID != nil {
		if err := s.settleModeProvider(ctx, *d.SettlementID, *d.CourierID); err != nil {
			return fmt.Errorf("transport: settle delivery: %w", err)
		}
	}
	if d.CourierID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *d.CourierID)
	}
	s.recordModeEvent(ctx, driverUserID, "business.delivery_delivered", "business_delivery", id, "picked_up", "delivered",
		map[string]any{"proof_url": proofURL})
	if d.BatchID != nil {
		s.rollupBatch(ctx, *d.BatchID)
	}
	return nil
}

// FailDelivery: assigned/picked_up → failed with a reason. Refunds prepaid escrow
// (no service rendered) and rolls the batch up to partially_failed.
func (s *Service) FailDelivery(ctx context.Context, id, driverUserID, reason string) error {
	d, err := s.courierOwnedDelivery(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if !canTransitionDelivery(d.Status, "failed") {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot fail from status %s", d.Status))
	}
	if err := s.deliverySetStatus(ctx, id, d.Status, "failed"); err != nil {
		return err
	}
	s.db.Exec(ctx, `UPDATE business_deliveries SET failure_reason=$1, updated_at=NOW() WHERE id=$2`, reason, id)
	// No delivery → refund the escrow (prepaid) or void the accrual (invoice).
	if d.SettlementID != nil {
		s.settlement.Refund(ctx, *d.SettlementID, "delivery_failed:"+reason)
	} else {
		s.voidAccrual(ctx, d.BusinessID, d.FareKobo)
	}
	if d.CourierID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', updated_at=NOW() WHERE id=$1`, *d.CourierID)
	}
	s.recordModeEvent(ctx, driverUserID, "business.delivery_failed", "business_delivery", id, d.Status, "failed",
		map[string]any{"failure_reason": reason})
	if d.BatchID != nil {
		s.rollupBatch(ctx, *d.BatchID)
	}
	return nil
}

// rollupBatch recomputes a batch's terminal status once no stops remain open:
// any failed → partially_failed, else completed.
func (s *Service) rollupBatch(ctx context.Context, batchID string) {
	var total, terminal, failed int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM business_deliveries WHERE batch_id=$1`, batchID).Scan(&total)
	s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM business_deliveries WHERE batch_id=$1 AND status IN ('delivered','failed','cancelled')`,
		batchID).Scan(&terminal)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM business_deliveries WHERE batch_id=$1 AND status='failed'`, batchID).Scan(&failed)
	if total == 0 || terminal < total {
		return // batch still in progress
	}
	final := "completed"
	if failed > 0 {
		final = "partially_failed"
	}
	s.db.Exec(ctx,
		`UPDATE delivery_batches SET status=$1 WHERE id=$2 AND status NOT IN ('completed','partially_failed','cancelled')`,
		final, batchID)
}

// courierOwnedDelivery loads a delivery and asserts the caller is the assigned courier.
func (s *Service) courierOwnedDelivery(ctx context.Context, id, driverUserID string) (*businessDeliveryRow, error) {
	driverID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	d, err := s.loadDelivery(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.CourierID == nil || *d.CourierID != driverID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the assigned courier")
	}
	return d, nil
}
