package domain

import (
	"strings"
	"time"
)

type AuthenticatedUser struct {
	ID            string   `json:"id"`
	Email         string   `json:"email"`
	Status        string   `json:"status"`
	EmailVerified bool     `json:"emailVerified"`
	Roles         []string `json:"roles"`
	Permissions   []string `json:"permissions"`
}

type LoginRequest struct {
	// Email stays for existing callers. New callers may send Identifier instead,
	// which accepts an email OR a phone number — see AuthService.LoginUser.
	Email string `json:"email" binding:"omitempty,email"`
	// Identifier is an email or a Nigerian phone number in any common format.
	Identifier string `json:"identifier"`
	Password   string `json:"password" binding:"required,min=8"`
}

// RegisterRequest is the single registration contract.
//
// The bindings were firstName+lastName+confirmPassword+userType, ALL required —
// while the only caller (apps/mobile-starter) posts {fullName, email, phone,
// password}. Registration through this endpoint returned 400 every time. Web and
// mobile send the same fullName shape, so requiring the split names would have
// made consolidation impossible.
//
// Both shapes are therefore accepted and reconciled by FullNameOrJoin.
// confirmPassword is validated only WHEN PRESENT: no client sends it (each
// confirms in its own form before submitting), so requiring it would reject
// every real caller to enforce a check none of them relies on.
type RegisterRequest struct {
	FullName        string `json:"fullName"`
	FirstName       string `json:"firstName"`
	LastName        string `json:"lastName"`
	Email           string `json:"email" binding:"required,email"`
	Phone           string `json:"phone"`
	Password        string `json:"password" binding:"required,min=8"`
	ConfirmPassword string `json:"confirmPassword"`
	UserType        string `json:"userType"`
	ReferralCode    string `json:"referralCode"`
	Country         string `json:"country"`
	State           string `json:"state"`
	City            string `json:"city"`
}

// FullNameOrJoin returns the display name, preferring an explicit fullName and
// falling back to "first last". This is the value the on_auth_user_created
// trigger copies into user_profiles.full_name, so an empty result means a
// nameless profile.
func (r RegisterRequest) FullNameOrJoin() string {
	if n := strings.TrimSpace(r.FullName); n != "" {
		return n
	}
	return strings.TrimSpace(strings.TrimSpace(r.FirstName) + " " + strings.TrimSpace(r.LastName))
}

// UserTypeOrDefault keeps the field optional without letting it reach Supabase empty.
func (r RegisterRequest) UserTypeOrDefault() string {
	if t := strings.TrimSpace(r.UserType); t != "" {
		return t
	}
	return "user"
}

type Role struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Description string    `json:"description"`
	RoleType    string    `json:"roleType"`
	IsSystem    bool      `json:"isSystemRole"`
	IsActive    bool      `json:"isActive"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Permission struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Module      string `json:"module"`
	Resource    string `json:"resource"`
	Action      string `json:"action"`
	Description string `json:"description"`
	IsSystem    bool   `json:"isSystemPermission"`
}
