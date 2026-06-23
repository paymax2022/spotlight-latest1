package domain

import "time"

type AuthenticatedUser struct {
	ID            string   `json:"id"`
	Email         string   `json:"email"`
	Status        string   `json:"status"`
	EmailVerified bool     `json:"emailVerified"`
	Roles         []string `json:"roles"`
	Permissions   []string `json:"permissions"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

type RegisterRequest struct {
	FirstName       string `json:"firstName" binding:"required"`
	LastName        string `json:"lastName" binding:"required"`
	Email           string `json:"email" binding:"required,email"`
	Phone           string `json:"phone"`
	Password        string `json:"password" binding:"required,min=8"`
	ConfirmPassword string `json:"confirmPassword" binding:"required"`
	UserType        string `json:"userType" binding:"required"`
	Country         string `json:"country"`
	State           string `json:"state"`
	City            string `json:"city"`
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
