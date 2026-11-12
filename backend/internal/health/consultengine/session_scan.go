package consultengine

// rowScanner is satisfied by pgx.Row and pgx.Rows, so one scanner serves every
// read path: single-row loads, RETURNING clauses and the sweeper's multi-row read.
type rowScanner interface {
	Scan(dest ...any) error
}

// sessionColumns is the canonical SELECT/RETURNING list for consult_sessions.
// Every read in this package uses it so scanSession can never drift from a query.
const sessionColumns = `id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	booked_start, ends_at, warn_at, warning_sent_at, state, room_name,
	base_hold_id, ended_at`

func scanSession(row rowScanner) (Session, error) {
	var sess Session
	var vertical, mode, ownerKind, state string
	err := row.Scan(&sess.ID, &vertical, &mode, &sess.PatientID, &ownerKind,
		&sess.ProviderOwnerID, &sess.ProviderUserID, &sess.SourceRef, &sess.PackageID,
		&sess.DurationMinutes, &sess.PriceKobo, &sess.BookedStart, &sess.EndsAt,
		&sess.WarnAt, &sess.WarningSentAt, &state, &sess.RoomName,
		&sess.BaseHoldID, &sess.EndedAt)
	if err != nil {
		return Session{}, err
	}
	sess.Vertical, sess.Mode = Vertical(vertical), Mode(mode)
	sess.ProviderOwnerKind, sess.State = OwnerKind(ownerKind), State(state)
	return sess, nil
}
