package top5events

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/cashtag"
)

// TeamMemberRow is one per-event team grant, enriched with the member's handle
// and display name for the organiser's team screen.
type TeamMemberRow struct {
	UserID    string    `json:"user_id"`
	Handle    string    `json:"handle"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	GrantedBy string    `json:"granted_by"`
	CreatedAt time.Time `json:"created_at"`
}

const teamMemberSelect = `
	SELECT m.user_id, COALESCE(ch.handle,''), COALESCE(up.full_name,''), m.role, m.granted_by, m.created_at
	FROM event_team_members m
	LEFT JOIN user_profiles up ON up.id = m.user_id
	LEFT JOIN cashtag_handles ch ON ch.user_id = m.user_id`

// AddTeamMember grants userHandle the MANAGER role on an event. OWNER-ONLY
// (assertOwner): a granted manager cannot grant others. Idempotent — replaying
// the same grant returns the stored row. Moves no money.
func (s *Service) AddTeamMember(ctx context.Context, callerID, eventID, userHandle, role string) (TeamMemberRow, error) {
	if err := s.assertOwner(ctx, eventID, callerID); err != nil {
		return TeamMemberRow{}, err
	}
	if role != "MANAGER" {
		return TeamMemberRow{}, fmt.Errorf("%w: events: role %q not available (MANAGER only)", ErrValidation, role)
	}
	uid, err := s.tags.Resolve(ctx, userHandle)
	if err != nil {
		if errors.Is(err, cashtag.ErrNotFound) {
			return TeamMemberRow{}, fmt.Errorf("%w: events: no user with handle %q", ErrValidation, userHandle)
		}
		return TeamMemberRow{}, fmt.Errorf("events: resolve handle: %w", err)
	}
	// assertOwner proved callerID is the organiser.
	if uid == callerID {
		return TeamMemberRow{}, fmt.Errorf("%w: events: the organiser already manages this event", ErrValidation)
	}
	const ins = `INSERT INTO event_team_members (id, event_id, user_id, role, granted_by)
	             VALUES ($1,$2,$3,'MANAGER',$4)
	             ON CONFLICT (event_id, user_id, role) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, uuid.New().String(), eventID, uid, callerID); err != nil {
		return TeamMemberRow{}, fmt.Errorf("events: add team member: %w", err)
	}
	var row TeamMemberRow
	if err := s.db.QueryRow(ctx, teamMemberSelect+` WHERE m.event_id=$1 AND m.user_id=$2 AND m.role='MANAGER'`, eventID, uid).
		Scan(&row.UserID, &row.Handle, &row.Name, &row.Role, &row.GrantedBy, &row.CreatedAt); err != nil {
		return TeamMemberRow{}, fmt.Errorf("events: read team member: %w", err)
	}
	s.log(callerID, "events.team.add", eventID, map[string]any{"user_id": uid, "role": "MANAGER"})
	return row, nil
}

// RemoveTeamMember revokes a user's MANAGER grant. OWNER-ONLY. Scoped to
// role='MANAGER' so a future FINANCE grant is not collaterally dropped; removing
// a non-member is a no-op success.
func (s *Service) RemoveTeamMember(ctx context.Context, callerID, eventID, userID string) error {
	if err := s.assertOwner(ctx, eventID, callerID); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx,
		`DELETE FROM event_team_members WHERE event_id=$1 AND user_id=$2 AND role='MANAGER'`,
		eventID, userID); err != nil {
		return fmt.Errorf("events: remove team member: %w", err)
	}
	s.log(callerID, "events.team.remove", eventID, map[string]any{"user_id": userID})
	return nil
}

// ListTeam lists an event's team grants, newest first. OWNER-ONLY.
func (s *Service) ListTeam(ctx context.Context, callerID, eventID string) ([]TeamMemberRow, error) {
	if err := s.assertOwner(ctx, eventID, callerID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, teamMemberSelect+` WHERE m.event_id=$1 ORDER BY m.created_at DESC`, eventID)
	if err != nil {
		return nil, fmt.Errorf("events: list team: %w", err)
	}
	defer rows.Close()
	out := []TeamMemberRow{}
	for rows.Next() {
		var r TeamMemberRow
		if err := rows.Scan(&r.UserID, &r.Handle, &r.Name, &r.Role, &r.GrantedBy, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("events: list team scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
