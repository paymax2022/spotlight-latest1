package healthpharmacy

import (
	"context"
	"fmt"
	"time"
)

// AdminListOrders is the admin order/delivery oversight read. It is the only path
// that may read across patients/pharmacies; RBAC health.pharmacy.orders gates the
// route and the read is parameterised.
func (s *Service) AdminListOrders(ctx context.Context, state, pharmacyProviderID string) ([]map[string]any, error) {
	const q = `
		SELECT id, patient_id, pharmacy_provider_id, prescription_id, state, fulfilment_method,
		       total_kobo, escrow_id, delivery_ref, created_at
		FROM pharmacy_orders
		WHERE ($1 = '' OR state = $1)
		  AND ($2 = '' OR pharmacy_provider_id = $2)
		ORDER BY created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, state, pharmacyProviderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, patient, prov, st, method string
		var rxID, escrowID, deliveryRef *string
		var total int64
		var createdAt time.Time
		if err := rows.Scan(&id, &patient, &prov, &rxID, &st, &method, &total, &escrowID, &deliveryRef, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "patient_id": patient, "pharmacy_provider_id": prov,
			"prescription_id": rxID, "state": st, "fulfilment_method": method,
			"total_kobo": total, "escrow_id": escrowID, "delivery_ref": deliveryRef, "created_at": createdAt,
		})
	}
	return out, nil
}

// AdminDispenseAudit is the immutable dispense audit read (HL-12). Each row is the
// pharmacist action that filled an order's e-Rx (dispense-once).
func (s *Service) AdminDispenseAudit(ctx context.Context, pharmacyProviderID string) ([]map[string]any, error) {
	const q = `
		SELECT d.id, d.order_id, d.prescription_id, d.pharmacist_id, d.created_at, o.pharmacy_provider_id
		FROM dispense_records d
		JOIN pharmacy_orders o ON o.id = d.order_id
		WHERE ($1 = '' OR o.pharmacy_provider_id = $1)
		ORDER BY d.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, pharmacyProviderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, orderID, pharmacist, prov string
		var rxID *string
		var createdAt time.Time
		if err := rows.Scan(&id, &orderID, &rxID, &pharmacist, &createdAt, &prov); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "order_id": orderID, "prescription_id": rxID,
			"pharmacist_id": pharmacist, "pharmacy_provider_id": prov, "created_at": createdAt,
		})
	}
	return out, nil
}

// AdminRecallProduct deactivates a catalog product (pharmacovigilance/recall).
// It never deletes (additive/audit-preserving); the product is set inactive so it
// drops out of the catalog read while history is retained.
func (s *Service) AdminRecallProduct(ctx context.Context, adminID, productID string) error {
	tag, err := s.db.Exec(ctx, `UPDATE pharmacy_products SET active=false, updated_at=now() WHERE id=$1`, productID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("pharmacy: product not found")
	}
	s.audited(adminID, "", "health.pharmacy.product.recall", productID,
		map[string]any{"active": true}, map[string]any{"active": false})
	return nil
}
