package announcements

import (
	"errors"
	"time"
)

// ErrValidation is the operator-facing refusal: the notice as written could not
// be published.
var ErrValidation = errors.New("announcements: invalid request")

// Tones the doctor banner can render. AnnouncementBanner.tsx looks tone up in a
// fixed palette and the provider-side read rewrites anything unrecognised to
// "info" rather than failing, so an unlisted tone is not a display question — it
// is a notice that silently loses the emphasis the author chose. The authoring
// surface is the only place that can still say no.
const (
	ToneInfo    = "info"
	ToneSuccess = "success"
	ToneWarning = "warning"
)

func validTone(tone string) bool {
	switch tone {
	case ToneInfo, ToneSuccess, ToneWarning:
		return true
	}
	return false
}

// PublishRequest is the body of the authoring call.
type PublishRequest struct {
	Title       string `json:"title"`
	Body        string `json:"body"`
	Tone        string `json:"tone"`
	Dismissible *bool  `json:"dismissible"`
	CtaLabel    string `json:"ctaLabel"`
	CtaRoute    string `json:"ctaRoute"`
}

// Published is the notice as authored, with how far it reached.
type Published struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	Tone        string    `json:"tone"`
	Dismissible bool      `json:"dismissible"`
	Recipients  int64     `json:"recipients"`
	PublishedAt time.Time `json:"publishedAt"`
}

// Item is one published notice in the console's history — a publication, not a
// per-doctor row.
type Item struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	Tone        string    `json:"tone"`
	Recipients  int64     `json:"recipients"`
	PublishedAt time.Time `json:"publishedAt"`
}
