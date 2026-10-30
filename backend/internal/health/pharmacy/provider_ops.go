package healthpharmacy

// Owner-scoped pharmacist work surfaces: low-stock alerts, the e-Rx verification
// queue and the controlled-substance register. Every query resolves scope from
// health_providers.owner_user_id server-side — a caller who owns no pharmacy
// gets empty lists, never another business's data.

import (
	"context"
	"fmt"
	"time"
)

// DefaultReorderLevel is the stock threshold at or below which a product raises
// a low-stock alert (the catalog has no per-product reorder level yet).
const DefaultReorderLevel = 10

// StockAlert is one active product at or below the reorder level.
type StockAlert struct {
	ProductID          string `json:"product_id"`
	PharmacyProviderID string `json:"pharmacy_provider_id"`
	Name               string `json:"name"`
	StockQty           int    `json:"stock_qty"`
	ReorderLevel       int    `json:"reorder_level"`
	Severity           string `json:"severity"` // "out" | "low"
}

// RxQueueItem is an e-Rx routed to one of the caller's pharmacies awaiting a
// pharmacist decision (HL-3).
type RxQueueItem struct {
	RxID               string    `json:"rx_id"`
	PharmacyProviderID string    `json:"pharmacy_provider_id"`
	PatientName        string    `json:"patient_name"`
	PrescriberName     string    `json:"prescriber_name"`
	State              string    `json:"state"`
	ItemCount          int       `json:"item_count"`
	CreatedAt          time.Time `json:"created_at"`
}

// ControlledLogEntry is one dispensed controlled-substance order line (HL-4
// register). At MVP is_controlled is CHECK-forced false, so this is empty until
// controlled substances are enabled — the query is real, not a placeholder.
type ControlledLogEntry struct {
	ID             string    `json:"id"`
	OrderID        string    `json:"order_id"`
	DrugName       string    `json:"drug_name"`
	Quantity       int       `json:"quantity"`
	PatientName    string    `json:"patient_name"`
	PharmacistName string    `json:"pharmacist_name"`
	DispensedAt    time.Time `json:"dispensed_at"`
}

func stockSeverity(qty int) string {
	if qty <= 0 {
		return "out"
	}
	return "low"
}

// StockAlertsForOwner lists active products at or below DefaultReorderLevel.
func (s *Service) StockAlertsForOwner(ctx context.Context, ownerID string) ([]StockAlert, error) {
	const q = `
		SELECT pr.id, pr.pharmacy_provider_id::text, pr.name, pr.stock_qty
		FROM pharmacy_products pr
		JOIN health_providers hp ON hp.id = pr.pharmacy_provider_id
		WHERE hp.owner_user_id = $1 AND pr.active = true AND pr.stock_qty <= $2
		ORDER BY pr.stock_qty ASC, pr.name ASC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, ownerID, DefaultReorderLevel)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: stock alerts: %w", err)
	}
	defer rows.Close()
	out := []StockAlert{}
	for rows.Next() {
		var a StockAlert
		if err := rows.Scan(&a.ProductID, &a.PharmacyProviderID, &a.Name, &a.StockQty); err != nil {
			return nil, err
		}
		a.ReorderLevel = DefaultReorderLevel
		a.Severity = stockSeverity(a.StockQty)
		out = append(out, a)
	}
	return out, rows.Err()
}

// RxQueueForOwner lists prescriptions routed to the caller's APPROVED pharmacies
// that still need a pharmacist decision (SENT_TO_PHARMACY / VERIFYING).
func (s *Service) RxQueueForOwner(ctx context.Context, ownerID string) ([]RxQueueItem, error) {
	const q = `
		SELECT rx.id, rx.pharmacy_provider_id::text,
		       COALESCE(pu.full_name, ''), COALESCE(pb.full_name, ''),
		       rx.state, (SELECT COUNT(*) FROM health_prescription_items it WHERE it.prescription_id = rx.id),
		       rx.created_at
		FROM health_prescriptions rx
		JOIN health_providers hp ON hp.id = rx.pharmacy_provider_id
		LEFT JOIN user_profiles pu ON pu.id = rx.patient_id
		LEFT JOIN user_profiles pb ON pb.id = rx.prescriber_id
		WHERE hp.owner_user_id = $1 AND hp.domain = 'PHARMACY' AND hp.status = 'APPROVED'
		  AND rx.state IN ('SENT_TO_PHARMACY', 'VERIFYING')
		ORDER BY rx.created_at ASC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: rx queue: %w", err)
	}
	defer rows.Close()
	out := []RxQueueItem{}
	for rows.Next() {
		var it RxQueueItem
		if err := rows.Scan(&it.RxID, &it.PharmacyProviderID, &it.PatientName, &it.PrescriberName,
			&it.State, &it.ItemCount, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// ControlledLogForOwner lists dispensed controlled-substance lines for the
// caller's pharmacies, newest first.
func (s *Service) ControlledLogForOwner(ctx context.Context, ownerID string) ([]ControlledLogEntry, error) {
	const q = `
		SELECT ol.id, o.id, ol.product_name, ol.quantity,
		       COALESCE(pu.full_name, ''), COALESCE(ph.full_name, ''), dr.created_at
		FROM dispense_records dr
		JOIN pharmacy_orders o       ON o.id = dr.order_id
		JOIN health_providers hp     ON hp.id = o.pharmacy_provider_id
		JOIN pharmacy_order_lines ol ON ol.order_id = o.id
		JOIN pharmacy_products pr    ON pr.id = ol.product_id
		LEFT JOIN user_profiles pu   ON pu.id = o.patient_id
		LEFT JOIN user_profiles ph   ON ph.id = dr.pharmacist_id
		WHERE hp.owner_user_id = $1 AND pr.is_controlled = true
		ORDER BY dr.created_at DESC
		LIMIT 500`
	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: controlled log: %w", err)
	}
	defer rows.Close()
	out := []ControlledLogEntry{}
	for rows.Next() {
		var e ControlledLogEntry
		if err := rows.Scan(&e.ID, &e.OrderID, &e.DrugName, &e.Quantity, &e.PatientName,
			&e.PharmacistName, &e.DispensedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
