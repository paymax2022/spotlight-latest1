package restaurant

import "context"

// ── Capability ↔ KYB bridge (foodhub A17) ───────────────────────────────────
//
// Spotlight answers two different questions with two unconnected systems:
//
//	onb_application  — "may this PERSON be a restaurant merchant?"  (capability)
//	restaurant_kyb   — "may this OUTLET be paid?"                   (payout gate)
//
// They are deliberately NOT merged: KYB is per outlet and capability is per
// person, so an owner's second outlet can carry different banking. Merging would
// either weaken payout verification or gate the capability behind per-restaurant
// banking.
//
// What was missing is the join. buildPayoutRun selects
// `AND res.kyb_status = 'approved'` (PY-007), so an outlet without approved KYB
// takes orders, settles into provider_kobo, and is then skipped by every payout
// run — with nothing surfaced to the owner or the admin. In the live data that is
// 1059 of 1075 outlets with no KYB row at all, 709 of them actively trading.
//
// This reports the join per outlet: can it be paid, why not, and how much has
// already piled up behind the gate.

// KYBStatusNone is the reported status for an outlet with NO restaurant_kyb row.
// It is deliberately distinct from a submitted-but-undecided one: "you have not
// started" and "we are reviewing" need different actions from the owner.
const KYBStatusNone = "none"

// OutletPayoutReadiness answers "can this outlet be paid, and if not, why?"
type OutletPayoutReadiness struct {
	RestaurantID string `json:"restaurant_id"`
	Name         string `json:"name"`
	// KYBStatus is the outlet's verification state, or KYBStatusNone.
	KYBStatus string `json:"kyb_status"`
	// Payable mirrors the payout query's gate exactly.
	Payable bool `json:"payable"`
	// Reason is owner-facing and empty when Payable.
	Reason string `json:"reason,omitempty"`
	// UnpaidKobo is settled provider money not yet in a payout line — what is
	// currently held behind the gate. Integer kobo.
	UnpaidKobo int64 `json:"unpaid_kobo"`
}

// PayoutReadinessForOwner reports, for every outlet the caller owns, whether it
// can currently be paid.
//
// The `payable` expression and the UnpaidKobo sum are written to mirror
// buildPayoutRun's own query (settled food_delivery settlements with
// provider_kobo > 0 and no existing payout line). If the two drift, the app
// promises money the payout engine will not release — so the gate condition here
// is intentionally the same literal comparison, not a re-interpretation.
func (s *Service) PayoutReadinessForOwner(ctx context.Context, ownerID string) ([]OutletPayoutReadiness, error) {
	const q = `
		SELECT r.id,
		       r.name,
		       COALESCE(NULLIF(r.kyb_status, ''), 'none')            AS kyb_status,
		       -- COALESCE, not a bare comparison: kyb_status is NULL for the 1059
		       -- outlets with no KYB row, and NULL = 'approved' evaluates to NULL,
		       -- not false. The payout query excludes NULL rows (NULL is not TRUE),
		       -- so readiness must report them as not payable, never as unknown.
		       (COALESCE(r.kyb_status, '') = 'approved')             AS payable,
		       COALESCE((
		         SELECT SUM(st.provider_kobo)
		         FROM settlements st
		         JOIN orders o ON o.id = replace(st.reference, 'order:', '')::uuid
		         WHERE st.module_type = 'food_delivery'
		           AND st.status = 'settled'
		           AND o.restaurant_id = r.id
		           AND st.provider_kobo > 0
		           AND NOT EXISTS (
		             SELECT 1 FROM restaurant_payout_lines pl WHERE pl.settlement_id = st.id
		           )
		       ), 0)::bigint                                          AS unpaid_kobo
		FROM restaurants r
		WHERE r.owner_id = $1
		ORDER BY r.name ASC`

	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []OutletPayoutReadiness{}
	for rows.Next() {
		var o OutletPayoutReadiness
		if err := rows.Scan(&o.RestaurantID, &o.Name, &o.KYBStatus, &o.Payable, &o.UnpaidKobo); err != nil {
			return nil, err
		}
		o.Reason = payoutBlockReason(o.KYBStatus, o.Payable)
		out = append(out, o)
	}
	return out, rows.Err()
}

// payoutBlockReason turns a KYB state into something the owner can act on.
//
// Extracted so the wording is tested rather than mirrored in a test: an outlet
// that cannot be paid and gives no reason is exactly the status quo this bridge
// exists to end.
func payoutBlockReason(kybStatus string, payable bool) string {
	if payable {
		return ""
	}
	switch kybStatus {
	case KYBStatusNone:
		return "Business verification not started. Submit your business details to receive payouts."
	case "submitted", "under_review":
		return "Business verification is being reviewed. Payouts start once it is approved."
	case "needs_info":
		return "Business verification needs more information. Check the details you submitted."
	case "rejected":
		return "Business verification was declined. Contact support to resolve it."
	default:
		return "Business verification is not approved yet, so payouts are on hold."
	}
}
