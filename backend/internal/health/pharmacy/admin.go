package healthpharmacy

import (
	"context"
	"fmt"
	"time"
)

// AdminListOrders is the admin order/delivery oversight read. It is the only path
// that may read across patients/pharmacies; RBAC health.pharmacy.orders gates the
// route and the read is parameterised.
//
// PHARMACY-001: also filters on fulfilmentMethod (fulfilment_method column) —
// the admin frontend (healthPharmacyAdminService.ts listOrders) has always sent
// a fulfilment filter; this backend simply never read it, so the filter
// silently no-op'd. Also joins health_providers for a human-readable pharmacy
// name (pharmacyName) so the admin console doesn't have to display raw UUIDs.
func (s *Service) AdminListOrders(ctx context.Context, state, fulfilmentMethod, pharmacyProviderID string) ([]map[string]any, error) {
	// nil (not "") for an unset filter. The original 2-param version of this
	// query used the same placeholder BOTH as `$N = ''` (a text comparison)
	// AND as `column = $N` against pharmacy_provider_id (a uuid column) —
	// live-tested for the first time this pass (admin_live_db_test.go), it
	// throws "operator does not exist: uuid = text" the moment the uuid filter
	// is ever actually supplied, because Postgres cannot unify one parameter
	// to two different types from its two use sites. Using NULL for "no
	// filter" and a single-context comparison per parameter sidesteps the
	// ambiguity entirely instead of leaning on a same-param dual-type coincidence.
	var statePtr, fulfilPtr, provPtr *string
	if state != "" {
		statePtr = &state
	}
	if fulfilmentMethod != "" {
		fulfilPtr = &fulfilmentMethod
	}
	if pharmacyProviderID != "" {
		provPtr = &pharmacyProviderID
	}
	const q = `
		SELECT o.id, o.patient_id, o.pharmacy_provider_id, hp.display_name, o.prescription_id,
		       o.state, o.fulfilment_method, o.total_kobo, o.escrow_id, o.delivery_ref, o.created_at
		FROM pharmacy_orders o
		LEFT JOIN health_providers hp ON hp.id = o.pharmacy_provider_id
		WHERE ($1::text IS NULL OR o.state = $1)
		  AND ($2::text IS NULL OR o.fulfilment_method = $2)
		  AND ($3::uuid IS NULL OR o.pharmacy_provider_id = $3::uuid)
		ORDER BY o.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, statePtr, fulfilPtr, provPtr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, patient, prov, st, method string
		var pharmacyName, rxID, escrowID, deliveryRef *string
		var total int64
		var createdAt time.Time
		if err := rows.Scan(&id, &patient, &prov, &pharmacyName, &rxID, &st, &method, &total, &escrowID, &deliveryRef, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "patient_id": patient, "pharmacy_provider_id": prov, "pharmacy_name": pharmacyName,
			"prescription_id": rxID, "state": st, "fulfilment_method": method,
			"total_kobo": total, "escrow_id": escrowID, "delivery_ref": deliveryRef, "created_at": createdAt,
		})
	}
	return out, nil
}

// AdminGetOrder is the admin-scoped single-order read (PHARMACY-001) — the
// discovery pass found only AdminListOrders (a list) existed; there was no way
// to open one order's detail from the admin console. Rather than a second query
// path that could drift from the patient/owner one, this reuses Get's existing
// isAdmin bypass (service.go): requesterID="" never equals PatientID, so the
// pickup code (the patient's counter credential) stays redacted for admin reads
// exactly as it already is for the pharmacy owner — admin oversight, not a
// fulfilment actor, never needs it.
func (s *Service) AdminGetOrder(ctx context.Context, orderID string) (*Order, error) {
	return s.Get(ctx, "", orderID, true)
}

// AdminDashboard aggregates platform-wide KPIs (PHARMACY-001). RBAC
// health.pharmacy.orders gates the route — the same admin-oversight permission
// AdminListOrders already uses; this is an extension of that existing surface,
// not a new admin capability, so no new permission slug is introduced.
func (s *Service) AdminDashboard(ctx context.Context) (*AdminDashboard, error) {
	out := &AdminDashboard{OrdersByState: make(map[string]int64, len(allOrderStates))}
	for _, st := range allOrderStates {
		out.OrdersByState[string(st)] = 0
	}

	rows, err := s.db.Query(ctx, `SELECT state, COUNT(*) FROM pharmacy_orders GROUP BY state`)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: admin dashboard orders-by-state: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int64
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out.OrdersByState[st] = n
		out.TotalOrders += n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// See AdminDashboard.PlatformRevenueKoboWeek's doc comment (admin_model.go)
	// for why this is a direct read of the commission module's own recorded
	// earning rows, in pure integer kobo, rather than a recomputed percentage.
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(spotlight_revenue_kobo), 0) FROM commission_earnings
		 WHERE source_module = 'health.pharmacy' AND created_at >= now() - interval '7 days'`,
	).Scan(&out.PlatformRevenueKoboWeek); err != nil {
		return nil, fmt.Errorf("pharmacy: admin dashboard platform revenue: %w", err)
	}

	// APPROVED pharmacies — the exact predicate DiscoverPharmacies/GetPharmacy/
	// pharmacyOwner (service.go) use for "is a real, live pharmacy".
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM health_providers
		 WHERE domain = 'PHARMACY' AND provider_type = 'pharmacy' AND status = 'APPROVED'`,
	).Scan(&out.TotalPharmacies); err != nil {
		return nil, fmt.Errorf("pharmacy: admin dashboard pharmacy count: %w", err)
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
