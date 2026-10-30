package healthproviders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrCredentialExpired refuses a reinstate while the application still carries
// an expired credential: the HL-2 licence sweep would re-suspend it on its next run.
var ErrCredentialExpired = errors.New("providers: a credential on this application has expired — renew it before reinstating")

// SetCapabilityStatus suspends or reinstates the capability behind providerID
// (health_providers.id) via the guarded application state machine, so the
// provider row, the application and the audit trail move together.
// action ∈ {suspend, reinstate}. Repeating an action is a no-op success.
func (s *Service) SetCapabilityStatus(ctx context.Context, adminID, providerID, action, note string) (*Application, error) {
	var appID, appState, provStatus string
	err := s.db.QueryRow(ctx, `
		SELECT a.id::text, a.state, p.status
		FROM health_provider_applications a
		JOIN health_providers p ON p.id = a.provider_id
		WHERE a.provider_id = $1
		ORDER BY a.updated_at DESC LIMIT 1`, providerID).Scan(&appID, &appState, &provStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrApplicationNotFound
	} else if err != nil {
		return nil, fmt.Errorf("providers: capability lookup: %w", err)
	}

	switch action {
	case "suspend":
		if State(appState) == StateSuspended {
			return s.getApplication(ctx, appID)
		}
		return s.transitionAdmin(ctx, adminID, appID, func(State) (State, error) { return StateSuspended, nil }, note)
	case "reinstate":
		var expired bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM health_credential_docs
			WHERE application_id=$1 AND expires_at IS NOT NULL AND expires_at < $2)`, appID, time.Now()).Scan(&expired); err != nil {
			return nil, fmt.Errorf("providers: credential expiry check: %w", err)
		}
		if expired {
			return nil, ErrCredentialExpired
		}
		if State(appState) == StateSuspended {
			return s.transitionAdmin(ctx, adminID, appID, func(State) (State, error) { return StateApproved, nil }, note)
		}
		if State(appState) != StateApproved {
			return nil, fmt.Errorf("providers: illegal transition %s -> %s", appState, StateApproved)
		}
		// Application APPROVED but capability suspended out-of-band (licence sweep
		// after a credential renewal): relist the capability only.
		if provStatus != "APPROVED" {
			if _, err := s.db.Exec(ctx, `UPDATE health_providers SET status='APPROVED', discoverable=true, updated_at=now() WHERE id=$1`, providerID); err != nil {
				return nil, fmt.Errorf("providers: reinstate capability: %w", err)
			}
			s.audited(adminID, "", "health.provider.capability.reinstate", providerID,
				map[string]any{"status": provStatus}, map[string]any{"status": "APPROVED", "note": note})
		}
		return s.getApplication(ctx, appID)
	default:
		return nil, fmt.Errorf("providers: unknown capability action %q", action)
	}
}
