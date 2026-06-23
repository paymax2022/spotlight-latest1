package connectverification

import "time"

// RetentionPolicy governs how long verification evidence references are kept
// before purge. Days is sourced from connect_config (verification.retention_days),
// keeping the policy backend-owned rather than hard-coded.
type RetentionPolicy struct{ Days int }

// Cutoff returns the timestamp before which evidence is past retention.
// A non-positive Days means "retain until configured" (no purge), returning the
// zero time.
func (p RetentionPolicy) Cutoff(now time.Time) time.Time {
	if p.Days <= 0 {
		return time.Time{}
	}
	return now.AddDate(0, 0, -p.Days)
}

// Expired reports whether evidence created at createdAt is past retention at now.
func (p RetentionPolicy) Expired(createdAt, now time.Time) bool {
	cutoff := p.Cutoff(now)
	if cutoff.IsZero() {
		return false
	}
	return createdAt.Before(cutoff)
}
