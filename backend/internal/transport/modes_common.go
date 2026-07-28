package transport

import (
	"context"

	"spotlight/backend/internal/finance/settlement"
)

// settlementSplit builds a provider/platform split from a commission config.
func settlementSplit(providerUserID string, comm *CommissionConfig) settlement.Split {
	return settlement.Split{
		ProviderID:  providerUserID,
		ProviderPct: comm.ProviderPct,
		PlatformPct: comm.PlatformPct,
	}
}

// ─── Shared helpers for the multi-modal modes (parcel/bus/towing/movers/car_hire) ───
//
// These modes don't use the trips/trip_events tables. State changes are recorded
// as immutable rows in transport_audit_log via recordModeEvent, which reuses the
// same audit sink as admin mutations (actor, action, entity, old/new, reason).

// recordModeEvent logs a mode state transition / lifecycle event to the audit log.
// actorID is the user (sender/courier/operator/provider) who triggered it.
func (s *Service) recordModeEvent(ctx context.Context, actorID, action, entityType, entityID string, from, to string, meta map[string]any) {
	oldVal := map[string]any{"status": from}
	newVal := map[string]any{"status": to}
	for k, v := range meta {
		newVal[k] = v
	}
	// writeAudit stores actor as admin_id; for mode events the actor is the
	// customer/provider. Reason is left empty.
	_ = writeAudit(ctx, s.db, actorID, action, entityType, entityID, oldVal, newVal, "")
}

// settleModeProvider settles a single escrow settlement to a provider/driver with
// the provider's commission tier split. settlementID is the row escrowed at booking.
func (s *Service) settleModeProvider(ctx context.Context, settlementID, providerDriverID string) error {
	var providerUserID, tier string
	if providerDriverID != "" {
		s.db.QueryRow(ctx, `SELECT user_id, commission_tier FROM drivers WHERE id=$1`, providerDriverID).Scan(&providerUserID, &tier)
	}
	comm, err := s.commissionForTier(ctx, tier)
	if err != nil {
		return err
	}
	split := settlementSplit(providerUserID, comm)
	return s.settlement.Settle(ctx, settlementID, split)
}
