package healthlab

import (
	"context"
	"fmt"
	"time"
)

// AdminListOrders is the admin order/results oversight read. It is the only path
// that may read across patients/labs; RBAC health.lab.orders gates the route and
// the read is parameterised.
func (s *Service) AdminListOrders(ctx context.Context, state, labProviderID string) ([]map[string]any, error) {
	// nil (not "") for an unset filter. The prior `$N = '' OR uuid_col = $N`
	// pattern reuses one placeholder as both a text-empty check and a uuid
	// comparison — Postgres cannot unify a single parameter to two types
	// from its two use sites, and throws "operator does not exist: uuid =
	// text" the moment the lab_provider_id filter is actually supplied. This
	// is the identical bug PHARMACY-006 found and fixed in the sibling
	// pharmacy admin query; fixed here the same way, before it was ever hit
	// live.
	var statePtr, provPtr *string
	if state != "" {
		statePtr = &state
	}
	if labProviderID != "" {
		provPtr = &labProviderID
	}
	const q = `
		SELECT id, patient_id, lab_provider_id, state, collection_method, total_kobo,
		       escrow_id, delivery_ref, result_record_id, created_at
		FROM lab_orders
		WHERE ($1::text IS NULL OR state = $1)
		  AND ($2::uuid IS NULL OR lab_provider_id = $2::uuid)
		ORDER BY created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, statePtr, provPtr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, patient, prov, st, method string
		var escrowID, deliveryRef, recordID *string
		var total int64
		var createdAt time.Time
		if err := rows.Scan(&id, &patient, &prov, &st, &method, &total, &escrowID, &deliveryRef, &recordID, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "patient_id": patient, "lab_provider_id": prov, "state": st,
			"collection_method": method, "total_kobo": total, "escrow_id": escrowID,
			"delivery_ref": deliveryRef, "result_record_id": recordID, "created_at": createdAt,
		})
	}
	return out, nil
}

// AdminCustodyAudit is the immutable chain-of-custody oversight read (HL-6/HL-12).
// Each row is one custody event; admin can trace any sample's chain.
//
// sampleID is a thin, additive filter (the admin frontend's custody detail
// drawer — healthLabAdminService.ts getCustodyChain — wants every event for
// ONE sample, not the whole audit list). It reuses this exact query rather
// than standing up a second custody read path: same nullable
// per-parameter-comparison discipline as labProviderID below, so passing both
// filters together (or neither) never hits the uuid/text ambiguity bug this
// query was already fixed for. patient_id is also selected (o.patient_id) —
// it was already available via the existing lab_orders join and lets the
// admin console mask the patient on the custody trail without a second query.
func (s *Service) AdminCustodyAudit(ctx context.Context, labProviderID, sampleID string) ([]map[string]any, error) {
	// Same uuid/text placeholder-reuse fix as AdminListOrders above.
	var provPtr, samplePtr *string
	if labProviderID != "" {
		provPtr = &labProviderID
	}
	if sampleID != "" {
		samplePtr = &sampleID
	}
	const q = `
		SELECT e.id, e.sample_id, e.from_state, e.to_state, e.actor_id, e.from_custodian,
		       e.to_custodian, e.note, e.occurred_at, o.lab_provider_id, o.id, o.patient_id
		FROM lab_custody_events e
		JOIN lab_samples sm ON sm.id = e.sample_id
		JOIN lab_orders  o  ON o.id  = sm.order_id
		WHERE ($1::uuid IS NULL OR o.lab_provider_id = $1::uuid)
		  AND ($2::uuid IS NULL OR e.sample_id = $2::uuid)
		ORDER BY e.occurred_at DESC LIMIT 300`
	rows, err := s.db.Query(ctx, q, provPtr, samplePtr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, sampleID, from, to, actor, prov, orderID, patientID string
		var fromCust, toCust *string
		var note string
		var at time.Time
		if err := rows.Scan(&id, &sampleID, &from, &to, &actor, &fromCust, &toCust, &note, &at, &prov, &orderID, &patientID); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "sample_id": sampleID, "order_id": orderID, "lab_provider_id": prov,
			"patient_id": patientID, "from_state": from, "to_state": to, "actor_id": actor,
			"from_custodian": fromCust, "to_custodian": toCust, "note": note, "occurred_at": at,
		})
	}
	return out, nil
}

// AdminEscalations is the critical-result escalation oversight read (HL-7). It
// surfaces every result that was flagged abnormal/critical and escalated, so the
// human escalation protocol is auditable and never silent.
func (s *Service) AdminEscalations(ctx context.Context, labProviderID string) ([]map[string]any, error) {
	// Same uuid/text placeholder-reuse fix as AdminListOrders/AdminCustodyAudit above.
	var provPtr *string
	if labProviderID != "" {
		provPtr = &labProviderID
	}
	const q = `
		SELECT r.id, r.order_id, r.test_name, r.status, r.escalated_at, r.released_at,
		       o.patient_id, o.lab_provider_id
		FROM lab_results r
		JOIN lab_orders o ON o.id = r.order_id
		WHERE r.status IN ('ABNORMAL','CRITICAL')
		  AND ($1::uuid IS NULL OR o.lab_provider_id = $1::uuid)
		ORDER BY r.escalated_at DESC NULLS LAST, r.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, provPtr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, orderID, testName, status, patient, prov string
		var escalatedAt, releasedAt *time.Time
		if err := rows.Scan(&id, &orderID, &testName, &status, &escalatedAt, &releasedAt, &patient, &prov); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "order_id": orderID, "test_name": testName, "status": status,
			"escalated_at": escalatedAt, "released_at": releasedAt,
			"patient_id": patient, "lab_provider_id": prov,
		})
	}
	return out, nil
}

// AdminDeactivateTest deactivates a catalog test (catalog governance). It never
// deletes (additive/audit-preserving); the test is set inactive so it drops out
// of the catalog read while order history is retained.
func (s *Service) AdminDeactivateTest(ctx context.Context, adminID, testID string) error {
	tag, err := s.db.Exec(ctx, `UPDATE lab_tests SET active=false, updated_at=now() WHERE id=$1`, testID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("lab: test not found")
	}
	s.audited(adminID, "", "health.lab.test.deactivate", testID,
		map[string]any{"active": true}, map[string]any{"active": false})
	return nil
}

// AdminDashboard aggregates platform-wide KPIs. RBAC health.lab.orders gates
// the route — the same admin-oversight permission AdminListOrders already
// uses; this is an extension of that existing surface, not a new admin
// capability, so no new permission slug is introduced. Mirrors
// healthpharmacy.Service.AdminDashboard (PHARMACY-001) exactly in shape and
// discipline.
func (s *Service) AdminDashboard(ctx context.Context) (*AdminDashboard, error) {
	out := &AdminDashboard{OrdersByState: make(map[string]int64, len(allOrderStates))}
	for _, st := range allOrderStates {
		out.OrdersByState[string(st)] = 0
	}

	rows, err := s.db.Query(ctx, `SELECT state, COUNT(*) FROM lab_orders GROUP BY state`)
	if err != nil {
		return nil, fmt.Errorf("lab: admin dashboard orders-by-state: %w", err)
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
		 WHERE source_module = 'health.lab' AND created_at >= now() - interval '7 days'`,
	).Scan(&out.PlatformRevenueKoboWeek); err != nil {
		return nil, fmt.Errorf("lab: admin dashboard platform revenue: %w", err)
	}

	// APPROVED labs — the exact predicate labProviderGateAdapter.IsApprovedLab
	// (backend/internal/app/health_lab_routes.go) uses for "is a real, live lab".
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM health_providers
		 WHERE domain = 'LAB' AND provider_type = 'lab' AND status = 'APPROVED'`,
	).Scan(&out.TotalLabs); err != nil {
		return nil, fmt.Errorf("lab: admin dashboard lab count: %w", err)
	}

	return out, nil
}
