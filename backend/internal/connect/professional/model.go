// Package connectprofessional implements Paymax Connect Phase 2 (professional
// networking): professional profiles + business verification, intro requests with
// CONSENT BEFORE MESSAGING, business-card exchange, saved contacts, and
// professional rooms with moderation. Deny-by-default authz; verification is a
// guarded state machine; no plaintext PII (evidence stored as an encrypted ref).
package connectprofessional

import "time"

// IntroStatus enumerates the intro-request lifecycle. Consent-before-messaging:
// only 'accepted' unlocks the card exchange / contact save.
type IntroStatus string

const (
	IntroPending   IntroStatus = "pending"
	IntroAccepted  IntroStatus = "accepted"
	IntroDeclined  IntroStatus = "declined"
	IntroWithdrawn IntroStatus = "withdrawn"
)

// VerificationStatus is the business-verification state machine.
type VerificationStatus string

const (
	VerUnverified VerificationStatus = "unverified"
	VerPending    VerificationStatus = "pending"
	VerVerified   VerificationStatus = "verified"
	VerRejected   VerificationStatus = "rejected"
)

type Profile struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	Headline           string    `json:"headline,omitempty"`
	Company            string    `json:"company,omitempty"`
	RoleTitle          string    `json:"role_title,omitempty"`
	Industry           string    `json:"industry,omitempty"`
	Bio                string    `json:"bio,omitempty"`
	VerificationStatus string    `json:"verification_status"`
	Visible            bool      `json:"visible"`
	CreatedAt          time.Time `json:"created_at"`
}

type IntroRequest struct {
	ID         string    `json:"id"`
	FromUserID string    `json:"from_user_id"`
	ToUserID   string    `json:"to_user_id"`
	Message    string    `json:"message,omitempty"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

type BusinessCard struct {
	ID      string `json:"id"`
	UserID  string `json:"user_id"`
	Name    string `json:"name"`
	Title   string `json:"title,omitempty"`
	Company string `json:"company,omitempty"`
	Email   string `json:"email,omitempty"`
	Phone   string `json:"phone,omitempty"`
}

type SavedContact struct {
	ID        string    `json:"id"`
	OwnerID   string    `json:"owner_id"`
	ContactID string    `json:"contact_id"`
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"created_at"`
}

type Room struct {
	ID         string    `json:"id"`
	OwnerID    string    `json:"owner_id"`
	Name       string    `json:"name"`
	Topic      string    `json:"topic,omitempty"`
	Visibility string    `json:"visibility"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

// --- Request DTOs ---

type ProfileInput struct {
	Headline  string `json:"headline"`
	Company   string `json:"company"`
	RoleTitle string `json:"role_title"`
	Industry  string `json:"industry"`
	Bio       string `json:"bio"`
}

type IntroInput struct {
	ToUserID string `json:"to_user_id" binding:"required"`
	Message  string `json:"message"`
}

type IntroResponse struct {
	Accept bool `json:"accept"`
}

type CardInput struct {
	Name    string `json:"name" binding:"required"`
	Title   string `json:"title"`
	Company string `json:"company"`
	Email   string `json:"email"`
	Phone   string `json:"phone"`
}

type RoomInput struct {
	Name       string `json:"name" binding:"required"`
	Topic      string `json:"topic"`
	Visibility string `json:"visibility"`
}

type RoomModerationInput struct {
	UserID string `json:"user_id" binding:"required"`
	Action string `json:"action" binding:"required"` // mute | remove | promote
}

// validIntroTransition guards the intro state machine (deny-by-default).
func validIntroTransition(from IntroStatus, to IntroStatus) bool {
	if from != IntroPending {
		return false // only a pending request may transition
	}
	switch to {
	case IntroAccepted, IntroDeclined, IntroWithdrawn:
		return true
	}
	return false
}
