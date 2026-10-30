package healthpharmacy

// Patient medication surfaces: reorder (re-price a past order's lines against
// the live catalog), the medication list (items on the patient's verified or
// dispensed prescriptions) and refills (dispensed items + a persisted schedule).
// All reads are scoped to the caller as patient; a foreign id is a uniform 404.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// RefillCycle is the default supply window used to derive a refill due date
// when no schedule row exists (prescription items carry no duration).
const RefillCycle = 30 * 24 * time.Hour

// ErrRefillNotFound is the uniform not-found/not-yours denial for refills.
var ErrRefillNotFound = errors.New("pharmacy: refill not found")

// ReorderLine is a past order line re-priced against the current catalog.
type ReorderLine struct {
	ProductID     string `json:"product_id"`
	ProductName   string `json:"product_name"`
	Quantity      int    `json:"quantity"`
	UnitPriceKobo int64  `json:"unit_price_kobo"`
	RxRequired    bool   `json:"rx_required"`
	Available     bool   `json:"available"` // still active, NAFDAC-registered and in stock
}

// Medication is one item on a patient's verified/dispensed prescription.
type Medication struct {
	ID             string    `json:"id"` // health_prescription_items.id
	PrescriptionID string    `json:"prescription_id"`
	DrugName       string    `json:"drug_name"`
	Dosage         string    `json:"dosage"`
	Quantity       int       `json:"quantity"`
	IsPOM          bool      `json:"is_pom"`
	RxState        string    `json:"rx_state"`
	PrescribedAt   time.Time `json:"prescribed_at"`
}

// Refill is a dispensed prescription item with its refill schedule.
type Refill struct {
	ID             string    `json:"id"` // health_prescription_items.id
	PrescriptionID string    `json:"prescription_id"`
	DrugName       string    `json:"drug_name"`
	Dosage         string    `json:"dosage"`
	DueAt          time.Time `json:"due_at"`
	Scheduled      bool      `json:"scheduled"`
	AutoRefill     bool      `json:"auto_refill"`
}

// Reorder re-prices the lines of the caller's own past order against the live
// catalog. It creates nothing — the client puts the lines back in the cart and
// checkout runs the normal HELD order flow (Idempotency-Key there).
func (s *Service) Reorder(ctx context.Context, patientID, orderID string) ([]ReorderLine, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT patient_id::text FROM pharmacy_orders WHERE id=$1`, orderID).Scan(&owner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOrderNotFound
		}
		return nil, fmt.Errorf("pharmacy: reorder: %w", err)
	}
	if owner != patientID {
		return nil, ErrOrderNotFound
	}
	const q = `
		SELECT ol.product_id::text, COALESCE(pr.name, ol.product_name), ol.quantity,
		       COALESCE(pr.price_kobo, ol.unit_price_kobo), COALESCE(pr.rx_required, ol.rx_required),
		       COALESCE(pr.active AND pr.nafdac_status = 'REGISTERED' AND pr.stock_qty >= ol.quantity, false)
		FROM pharmacy_order_lines ol
		LEFT JOIN pharmacy_products pr ON pr.id = ol.product_id
		WHERE ol.order_id = $1
		ORDER BY ol.created_at ASC`
	rows, err := s.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: reorder lines: %w", err)
	}
	defer rows.Close()
	out := []ReorderLine{}
	for rows.Next() {
		var l ReorderLine
		if err := rows.Scan(&l.ProductID, &l.ProductName, &l.Quantity, &l.UnitPriceKobo, &l.RxRequired, &l.Available); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Medications lists items on the caller's VERIFIED/DISPENSED/FULFILLED prescriptions.
func (s *Service) Medications(ctx context.Context, patientID string) ([]Medication, error) {
	const q = `
		SELECT it.id, rx.id, it.drug_name, it.dosage, it.quantity, it.is_pom, rx.state, rx.created_at
		FROM health_prescription_items it
		JOIN health_prescriptions rx ON rx.id = it.prescription_id
		WHERE rx.patient_id = $1 AND rx.state IN ('VERIFIED', 'DISPENSED', 'FULFILLED')
		ORDER BY rx.created_at DESC, it.drug_name ASC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, patientID)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: medications: %w", err)
	}
	defer rows.Close()
	out := []Medication{}
	for rows.Next() {
		var m Medication
		if err := rows.Scan(&m.ID, &m.PrescriptionID, &m.DrugName, &m.Dosage, &m.Quantity, &m.IsPOM, &m.RxState, &m.PrescribedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Refills lists dispensed prescription items with their schedule; due_at falls
// back to dispensed_at (or created_at) + RefillCycle when unscheduled.
func (s *Service) Refills(ctx context.Context, patientID string) ([]Refill, error) {
	const q = `
		SELECT it.id, rx.id, it.drug_name, it.dosage,
		       COALESCE(rs.due_at, COALESCE(rx.dispensed_at, rx.created_at) + make_interval(secs => $2)),
		       rs.id IS NOT NULL, COALESCE(rs.auto_refill, false)
		FROM health_prescription_items it
		JOIN health_prescriptions rx ON rx.id = it.prescription_id
		LEFT JOIN pharmacy_refill_schedules rs ON rs.rx_item_id = it.id AND rs.patient_id = rx.patient_id
		WHERE rx.patient_id = $1 AND rx.state IN ('DISPENSED', 'FULFILLED')
		ORDER BY 5 ASC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, patientID, RefillCycle.Seconds())
	if err != nil {
		return nil, fmt.Errorf("pharmacy: refills: %w", err)
	}
	defer rows.Close()
	out := []Refill{}
	for rows.Next() {
		var r Refill
		if err := rows.Scan(&r.ID, &r.PrescriptionID, &r.DrugName, &r.Dosage, &r.DueAt, &r.Scheduled, &r.AutoRefill); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ScheduleRefill upserts the caller's schedule for one dispensed item. Repeating
// the call is idempotent (one row per patient+item).
func (s *Service) ScheduleRefill(ctx context.Context, patientID, itemID string, autoRefill bool) (*Refill, error) {
	var ok bool
	const own = `SELECT EXISTS (
		SELECT 1 FROM health_prescription_items it
		JOIN health_prescriptions rx ON rx.id = it.prescription_id
		WHERE it.id = $1 AND rx.patient_id = $2 AND rx.state IN ('DISPENSED', 'FULFILLED'))`
	if err := s.db.QueryRow(ctx, own, itemID, patientID).Scan(&ok); err != nil {
		return nil, fmt.Errorf("pharmacy: schedule refill: %w", err)
	}
	if !ok {
		return nil, ErrRefillNotFound
	}
	const up = `
		INSERT INTO pharmacy_refill_schedules (patient_id, rx_item_id, auto_refill, due_at)
		SELECT $1, it.id, $3, COALESCE(rx.dispensed_at, rx.created_at) + make_interval(secs => $4)
		FROM health_prescription_items it JOIN health_prescriptions rx ON rx.id = it.prescription_id
		WHERE it.id = $2
		ON CONFLICT (patient_id, rx_item_id)
		DO UPDATE SET auto_refill = EXCLUDED.auto_refill, updated_at = now()`
	if _, err := s.db.Exec(ctx, up, patientID, itemID, autoRefill, RefillCycle.Seconds()); err != nil {
		return nil, fmt.Errorf("pharmacy: schedule refill: %w", err)
	}
	s.audited(patientID, "", "health.pharmacy.refill.schedule", itemID, nil, map[string]any{"auto_refill": autoRefill})
	rows, err := s.Refills(ctx, patientID)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].ID == itemID {
			return &rows[i], nil
		}
	}
	return nil, ErrRefillNotFound
}
