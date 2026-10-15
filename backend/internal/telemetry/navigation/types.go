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

// AnalyticsFilter scopes an aggregate read. Range is "7d"|"30d"|"90d" and
// Surface "all"|"mobile"|"web"; unknown values fall back to 30d / all.
type AnalyticsFilter struct {
	Range   string
	Surface string
	Search  string
}

// TopScreen is one route's view count and distinct-user count.
type TopScreen struct {
	Route string
	Views int64
	Users int64
}

// DayBucket is one UTC day's views by surface. Day is YYYY-MM-DD.
type DayBucket struct {
	Day    string
	Mobile int64
	Web    int64
	Total  int64
}

// SurfaceSplit is the window's views by surface.
type SurfaceSplit struct {
	Mobile int64
	Web    int64
	Total  int64
}

// NavAnalytics is the aggregate navigation read model. It carries no user ids.
type NavAnalytics struct {
	TopScreens   []TopScreen
	Timeseries   []DayBucket
	SurfaceSplit SurfaceSplit
}
