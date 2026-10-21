package restaurant

// FOOD-UAT-G-006 admin order trace (RBAC restaurant.admin.trace):
//   GET /api/restaurant/admin/orders/:id/trace
//
// READ-ONLY chronological event history for one order, stitched from the tables
// that already record each facet (no new write path, ADR-040 unaffected):
//   transition   audit_logs  (action order.status.*, resource_type=order)
//   dispatch     restaurant_delivery_offers (offered / responded)
//   payment      settlements (escrowed / settled) + ledger_entries for the order
//   dispute      disputes (module_type=food) + audit order.chargeback.* / refund decisions
//   payout       restaurant_payout_lines → restaurant_payout_runs + payout audit rows
//   code_lockout orders.pickup_/delivery_ attempts + locked_until (current state)
//
// Known gap: transitions REFUSED by the compare-and-set guard are not persisted
// anywhere today, so they cannot appear here; only transitions that succeeded do.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/httperr"
)

// TraceEvent is one row of the order timeline.
type TraceEvent struct {
	ID            string          `json:"id"`
	Kind          string          `json:"kind"`
	ActorUserID   *string         `json:"actor_user_id"`
	At            time.Time       `json:"at"`
	Before        json.RawMessage `json:"before"`
	After         json.RawMessage `json:"after"`
	Note          string          `json:"note"`
	CorrelationID string          `json:"correlation_id"`
}

func jraw(v any) json.RawMessage {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

// AdminOrderTrace assembles the timeline. pgx.ErrNoRows ⇒ unknown order.
func (s *Service) AdminOrderTrace(ctx context.Context, orderID string) ([]TraceEvent, error) {
	var (
		custID, restID, status, settlementID string
		riderID                              *string
		total                                int64
		createdAt, updatedAt                 time.Time
		pAtt, dAtt                           int
		pLock, dLock                         *time.Time
	)
	err := s.db.QueryRow(ctx, `
		SELECT customer_id::text, restaurant_id::text, status, COALESCE(settlement_id::text,''), rider_id::text,
		       total_kobo, created_at, updated_at,
		       COALESCE(pickup_attempts,0), pickup_locked_until, COALESCE(delivery_attempts,0), delivery_locked_until
		  FROM orders WHERE id=$1`, orderID).
		Scan(&custID, &restID, &status, &settlementID, &riderID, &total, &createdAt, &updatedAt, &pAtt, &pLock, &dAtt, &dLock)
	if err != nil {
		return nil, err
	}
	ev := []TraceEvent{{
		ID: "order:" + orderID, Kind: "order", ActorUserID: &custID, At: createdAt, CorrelationID: orderID,
		After: jraw(map[string]any{"status": "pending", "total_kobo": total, "restaurant_id": restID}),
		Note:  "order placed",
	}}

	// Audit trail (transitions, chargebacks, anything else keyed to the order).
	ar, err := s.db.Query(ctx, `
		SELECT id::text, action, actor_user_id::text, created_at, old_values, new_values
		  FROM audit_logs
		 WHERE module='restaurant' AND resource_type='order' AND resource_id=$1`, orderID)
	if err != nil {
		return nil, err
	}
	for ar.Next() {
		var id, action string
		var actor *string
		var at time.Time
		var ov, nv []byte
		if err := ar.Scan(&id, &action, &actor, &at, &ov, &nv); err != nil {
			ar.Close()
			return nil, err
		}
		kind := "audit"
		switch {
		case len(action) >= 13 && action[:13] == "order.status.":
			kind = "transition"
		case len(action) >= 16 && action[:16] == "order.chargeback":
			kind = "dispute"
		}
		ev = append(ev, TraceEvent{ID: "audit:" + id, Kind: kind, ActorUserID: actor, At: at, Before: ov, After: nv, Note: action, CorrelationID: orderID})
	}
	ar.Close()
	if err := ar.Err(); err != nil {
		return nil, err
	}

	// Dispatch offers.
	or, err := s.db.Query(ctx, `
		SELECT id::text, rider_id::text, status, distance_m, created_at, responded_at
		  FROM restaurant_delivery_offers WHERE order_id=$1`, orderID)
	if err != nil {
		return nil, err
	}
	for or.Next() {
		var id, rider, st string
		var dist *float64
		var created time.Time
		var responded *time.Time
		if err := or.Scan(&id, &rider, &st, &dist, &created, &responded); err != nil {
			or.Close()
			return nil, err
		}
		rid := rider
		ev = append(ev, TraceEvent{ID: "offer:" + id + ":offered", Kind: "dispatch", ActorUserID: nil, At: created, CorrelationID: id,
			After: jraw(map[string]any{"rider_id": rider, "distance_m": dist}), Note: "delivery offered to rider"})
		if responded != nil {
			ev = append(ev, TraceEvent{ID: "offer:" + id + ":responded", Kind: "dispatch", ActorUserID: &rid, At: *responded, CorrelationID: id,
				Before: jraw(map[string]any{"status": "offered"}), After: jraw(map[string]any{"status": st}), Note: "rider offer " + st})
		}
	}
	or.Close()
	if err := or.Err(); err != nil {
		return nil, err
	}

	// Payment: settlement + ledger legs.
	if settlementID != "" {
		var sst string
		var tot, fee, prov int64
		var escrowed time.Time
		var settled *time.Time
		if err := s.db.QueryRow(ctx, `SELECT status, total_kobo, fee_kobo, provider_kobo, escrowed_at, settled_at FROM settlements WHERE id=$1`, settlementID).
			Scan(&sst, &tot, &fee, &prov, &escrowed, &settled); err == nil {
			ev = append(ev, TraceEvent{ID: "settlement:" + settlementID + ":escrow", Kind: "payment", ActorUserID: &custID, At: escrowed, CorrelationID: settlementID,
				After: jraw(map[string]any{"status": "escrowed", "total_kobo": tot}), Note: "payment escrowed"})
			if settled != nil {
				ev = append(ev, TraceEvent{ID: "settlement:" + settlementID + ":settled", Kind: "payment", At: *settled, CorrelationID: settlementID,
					Before: jraw(map[string]any{"status": "escrowed"}),
					After:  jraw(map[string]any{"status": sst, "provider_kobo": prov, "platform_fee_kobo": fee, "rider_and_other_kobo": tot - prov - fee}),
					Note:   "settlement " + sst})
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	lr, err := s.db.Query(ctx, `
		SELECT id::text, type, amount_kobo, reference, idempotency_key, created_at
		  FROM ledger_entries
		 WHERE reference LIKE '%' || $1 || '%'
		    OR ($2 <> '' AND idempotency_key LIKE 'settle:' || $2 || ':%')`, orderID, settlementID)
	if err != nil {
		return nil, err
	}
	for lr.Next() {
		var id, typ, ref, idem string
		var amt int64
		var at time.Time
		if err := lr.Scan(&id, &typ, &amt, &ref, &idem, &at); err != nil {
			lr.Close()
			return nil, err
		}
		corr := settlementID
		if corr == "" {
			corr = orderID
		}
		ev = append(ev, TraceEvent{ID: "ledger:" + id, Kind: "payment", At: at, CorrelationID: corr,
			After: jraw(map[string]any{"type": typ, "amount_kobo": amt, "reference": ref}), Note: "ledger " + typ + " " + idem})
	}
	lr.Close()
	if err := lr.Err(); err != nil {
		return nil, err
	}

	// Disputes (+ their audit rows: refund approvals).
	dr, err := s.db.Query(ctx, `
		SELECT id::text, user_id::text, status, COALESCE(resolution,''), COALESCE(admin_note,''), type, created_at, updated_at
		  FROM disputes WHERE reference=$1 AND module_type='food'`, orderID)
	if err != nil {
		return nil, err
	}
	var disputeIDs []string
	for dr.Next() {
		var id, uid, st, res, note, typ string
		var created, updated time.Time
		if err := dr.Scan(&id, &uid, &st, &res, &note, &typ, &created, &updated); err != nil {
			dr.Close()
			return nil, err
		}
		disputeIDs = append(disputeIDs, id)
		u := uid
		ev = append(ev, TraceEvent{ID: "dispute:" + id + ":opened", Kind: "dispute", ActorUserID: &u, At: created, CorrelationID: id,
			After: jraw(map[string]any{"status": "open", "type": typ}), Note: "dispute opened"})
		if updated.After(created) && st != "open" {
			ev = append(ev, TraceEvent{ID: "dispute:" + id + ":updated", Kind: "dispute", At: updated, CorrelationID: id,
				Before: jraw(map[string]any{"status": "open"}), After: jraw(map[string]any{"status": st, "resolution": res}), Note: note})
		}
	}
	dr.Close()
	if err := dr.Err(); err != nil {
		return nil, err
	}
	if len(disputeIDs) > 0 {
		da, err := s.db.Query(ctx, `
			SELECT id::text, action, actor_user_id::text, created_at, old_values, new_values, resource_id
			  FROM audit_logs WHERE module='restaurant' AND resource_type='dispute' AND resource_id = ANY($1)`, disputeIDs)
		if err != nil {
			return nil, err
		}
		for da.Next() {
			var id, action, rid string
			var actor *string
			var at time.Time
			var ov, nv []byte
			if err := da.Scan(&id, &action, &actor, &at, &ov, &nv, &rid); err != nil {
				da.Close()
				return nil, err
			}
			ev = append(ev, TraceEvent{ID: "audit:" + id, Kind: "dispute", ActorUserID: actor, At: at, Before: ov, After: nv, Note: action, CorrelationID: rid})
		}
		da.Close()
		if err := da.Err(); err != nil {
			return nil, err
		}
	}

	// Payout / commission: lines folded into runs.
	pr, err := s.db.Query(ctx, `
		SELECT pl.id::text, pl.amount_minor, pl.created_at, r.id::text, r.provider_type, r.status, r.fee_minor
		  FROM restaurant_payout_lines pl JOIN restaurant_payout_runs r ON r.id = pl.run_id
		 WHERE pl.order_id=$1`, orderID)
	if err != nil {
		return nil, err
	}
	var runIDs []string
	for pr.Next() {
		var id, run, ptype, rst string
		var amt, fee int64
		var at time.Time
		if err := pr.Scan(&id, &amt, &at, &run, &ptype, &rst, &fee); err != nil {
			pr.Close()
			return nil, err
		}
		runIDs = append(runIDs, run)
		ev = append(ev, TraceEvent{ID: "payout-line:" + id, Kind: "payout", At: at, CorrelationID: run,
			After: jraw(map[string]any{"provider_type": ptype, "amount_kobo": amt, "run_status": rst, "run_fee_kobo": fee}), Note: "added to " + ptype + " payout run"})
	}
	pr.Close()
	if err := pr.Err(); err != nil {
		return nil, err
	}
	if len(runIDs) > 0 {
		pa, err := s.db.Query(ctx, `
			SELECT id::text, action, actor_user_id::text, created_at, old_values, new_values, resource_id
			  FROM audit_logs WHERE module='restaurant' AND resource_type='payout_run' AND resource_id = ANY($1)`, runIDs)
		if err != nil {
			return nil, err
		}
		for pa.Next() {
			var id, action, rid string
			var actor *string
			var at time.Time
			var ov, nv []byte
			if err := pa.Scan(&id, &action, &actor, &at, &ov, &nv, &rid); err != nil {
				pa.Close()
				return nil, err
			}
			ev = append(ev, TraceEvent{ID: "audit:" + id, Kind: "payout", ActorUserID: actor, At: at, Before: ov, After: nv, Note: action, CorrelationID: rid})
		}
		pa.Close()
		if err := pa.Err(); err != nil {
			return nil, err
		}
	}

	// Code lockouts (current state: attempts + lock expiry).
	for _, c := range []struct {
		name string
		att  int
		lock *time.Time
	}{{"pickup", pAtt, pLock}, {"delivery", dAtt, dLock}} {
		if c.att == 0 && c.lock == nil {
			continue
		}
		at := updatedAt
		note := c.name + " code: failed attempts recorded"
		if c.lock != nil {
			note = c.name + " code locked until " + c.lock.UTC().Format(time.RFC3339)
		}
		ev = append(ev, TraceEvent{ID: "lockout:" + orderID + ":" + c.name, Kind: "code_lockout", At: at, CorrelationID: orderID,
			After: jraw(map[string]any{"attempts": c.att, "locked_until": c.lock}), Note: note})
	}

	sort.SliceStable(ev, func(i, j int) bool { return ev[i].At.Before(ev[j].At) })
	return ev, nil
}

// AdminOrderTrace → GET /api/restaurant/admin/orders/:id/trace.
func (h *Handler) AdminOrderTrace(c *gin.Context) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "order id must be a uuid"})
		return
	}
	ev, err := h.svc.AdminOrderTrace(c.Request.Context(), id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		c.JSON(http.StatusNotFound, gin.H{keyError: "order not found"})
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	default:
		c.JSON(http.StatusOK, gin.H{"events": ev})
	}
}
