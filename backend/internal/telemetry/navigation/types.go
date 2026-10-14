// Package navigation stores a privacy-preserving log of which screens/pages
// users visit. Only user_id, surface, route and timestamps are persisted.
package navigation

import "time"

// Event is one navigation (screen/page view). Route must be a normalized
// route template, never a URL with query strings or identifiers.
type Event struct {
	UserID     string
	Surface    string // "mobile" | "web"
	Route      string
	OccurredAt time.Time
}
