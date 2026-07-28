package feesfeeschedule

import (
	"encoding/json"
	"errors"
	"time"
)

// Package feesfeeschedule owns the FeeSchedule entity of the EdTech School-Fees module,
// built against public.academy_fee_schedules (edupay spine + the fees extension columns
// session_id, class_id, fee_items, installment_policy, locked — migration
// 20260918000000_academy_fees_edtech.sql).
//
// SF-1 (release blocker): a FeeSchedule becomes IMMUTABLE once an Invoice references it.
// This package enforces that in the SERVICE layer (service.go): any mutating operation
// fails with ErrFeeScheduleImmutable when the schedule is `locked` OR when a row in
// academy_invoices references it. The DB lock trigger (migration §B) is a backstop, not
// the primary guard.
//
// SF-6: installment terms are part of the immutable schedule — fee_items +
// installment_policy are set at CREATION ONLY and can never change afterwards.
//
// Money is int64 minor units (kobo). This package moves no money.

// FeeSchedule mirrors public.academy_fee_schedules (with the fees extension columns).
type FeeSchedule struct {
	ID                string          `json:"id"`
	SchoolID          string          `json:"schoolId"`
	SessionID         *string         `json:"sessionId,omitempty"`
	ClassID           *string         `json:"classId,omitempty"`
	ClassCode         *string         `json:"classCode,omitempty"`
	Term              *string         `json:"term,omitempty"`
	Name              string          `json:"name"`
	AmountMinor       int64           `json:"amountMinor"`
	Currency          string          `json:"currency"`
	FeeItems          json.RawMessage `json:"feeItems"`          // SF-6: immutable line items
	InstallmentPolicy json.RawMessage `json:"installmentPolicy"` // SF-6: immutable installment terms
	Locked            bool            `json:"locked"`            // SF-1: true once invoiced
	DueDate           *time.Time      `json:"dueDate,omitempty"`
	Status            string          `json:"status"`
	CreatedAt         time.Time       `json:"createdAt"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreateFeeScheduleRequest publishes a fee schedule for a school. fee_items +
// installment_policy are captured HERE and only here (SF-6 — immutable thereafter).
type CreateFeeScheduleRequest struct {
	SchoolID          string          `json:"schoolId" binding:"required"`
	SessionID         string          `json:"sessionId"`
	ClassID           string          `json:"classId"`
	ClassCode         string          `json:"classCode"`
	Term              string          `json:"term"`
	Name              string          `json:"name" binding:"required"`
	AmountMinor       int64           `json:"amountMinor" binding:"required"`
	Currency          string          `json:"currency"`
	FeeItems          json.RawMessage `json:"feeItems"`
	InstallmentPolicy json.RawMessage `json:"installmentPolicy"`
	DueDate           string          `json:"dueDate"` // YYYY-MM-DD
}

// UpdateFeeScheduleRequest edits the MUTABLE-BEFORE-LOCK fields of a schedule. It can
// NEVER touch fee_items / installment_policy (SF-6) and the whole update is refused once
// the schedule is locked/referenced (SF-1). Only name/dueDate are editable pre-lock.
type UpdateFeeScheduleRequest struct {
	Name    string `json:"name"`
	DueDate string `json:"dueDate"` // YYYY-MM-DD; "" leaves unchanged
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound        = errors.New("not_found")
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrMissingName     = errors.New("missing_name")
	ErrInvalidAmount   = errors.New("invalid_amount")
	ErrInvalidDate     = errors.New("invalid_date")
	// ErrFeeScheduleImmutable is the SF-1 guard: the schedule is locked or already
	// referenced by an issued invoice, so no mutation (update, delete, re-price,
	// installment change) is permitted. Distinct code so the invariant is observable.
	ErrFeeScheduleImmutable = errors.New("fee_schedule_immutable")
)
