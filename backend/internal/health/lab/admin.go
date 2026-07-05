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
	const q = `
		SELECT id, patient_id, lab_provider_id, state, collection_method, total_kobo,
		       escrow_id, delivery_ref, result_record_id, created_at
		FROM lab_orders
		WHERE ($1 = '' OR state = $1)
		  AND ($2 = '' OR lab_provider_id = $2)
		ORDER BY created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, state, labProviderID)
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
func (s *Service) AdminCustodyAudit(ctx context.Context, labProviderID string) ([]map[string]any, error) {
	const q = `
		SELECT e.id, e.sample_id, e.from_state, e.to_state, e.actor_id, e.from_custodian,
		       e.to_custodian, e.note, e.occurred_at, o.lab_provider_id, o.id
		FROM lab_custody_events e
		JOIN lab_samples sm ON sm.id = e.sample_id
		JOIN lab_orders  o  ON o.id  = sm.order_id
		WHERE ($1 = '' OR o.lab_provider_id = $1)
		ORDER BY e.occurred_at DESC LIMIT 300`
	rows, err := s.db.Query(ctx, q, labProviderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, sampleID, from, to, actor, prov, orderID string
		var fromCust, toCust *string
		var note string
		var at time.Time
		if err := rows.Scan(&id, &sampleID, &from, &to, &actor, &fromCust, &toCust, &note, &at, &prov, &orderID); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "sample_id": sampleID, "order_id": orderID, "lab_provider_id": prov,
			"from_state": from, "to_state": to, "actor_id": actor,
			"from_custodian": fromCust, "to_custodian": toCust, "note": note, "occurred_at": at,
		})
	}
	return out, nil
}

// AdminEscalations is the critical-result escalation oversight read (HL-7). It
// surfaces every result that was flagged abnormal/critical and escalated, so the
// human escalation protocol is auditable and never silent.
func (s *Service) AdminEscalations(ctx context.Context, labProviderID string) ([]map[string]any, error) {
	const q = `
		SELECT r.id, r.order_id, r.test_name, r.status, r.escalated_at, r.released_at,
		       o.patient_id, o.lab_provider_id
		FROM lab_results r
		JOIN lab_orders o ON o.id = r.order_id
		WHERE r.status IN ('ABNORMAL','CRITICAL')
		  AND ($1 = '' OR o.lab_provider_id = $1)
		ORDER BY r.escalated_at DESC NULLS LAST, r.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, labProviderID)
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
