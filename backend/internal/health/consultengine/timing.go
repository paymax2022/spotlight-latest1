package consultengine

import "time"

// WarnLead is the warning lead time: five minutes, or a fifth of a shorter
// window so the warning never covers the whole session.
func WarnLead(window time.Duration) time.Duration {
	if window <= 0 {
		return 0
	}
	lead := window / 5
	if lead > WarningCap {
		lead = WarningCap
	}
	return lead
}

// WarnAt is the warning instant for a window that starts at start and ends at ends.
func WarnAt(start, ends time.Time) time.Time {
	return ends.Add(-WarnLead(ends.Sub(start)))
}

// ExtensionPriceKobo prices added minutes pro rata from the session snapshot,
// rounding up so an extension is never sold for less than its share.
func ExtensionPriceKobo(priceKobo int64, durationMinutes, addedMinutes int) int64 {
	if priceKobo <= 0 || durationMinutes <= 0 || addedMinutes <= 0 {
		return 0
	}
	d := int64(durationMinutes)
	return (priceKobo*int64(addedMinutes) + d - 1) / d
}

// JoinTTL caps a join token so it cannot outlive the session by more than a
// minute, with a one-minute floor for a last-second join.
func JoinTTL(now, endsAt time.Time, configured time.Duration) time.Duration {
	if configured <= 0 {
		configured = DefaultJoinTTL
	}
	remaining := endsAt.Sub(now)
	if remaining >= time.Minute {
		remaining += time.Minute
	} else {
		// A last-second join gets the floor itself, not the floor plus slack.
		remaining = time.Minute
	}
	if remaining > configured {
		return configured
	}
	return remaining
}
