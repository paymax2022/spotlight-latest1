package feesfeeschedule

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns FeeSchedule creation + the SF-1 immutability guard. It moves no money.
//
// SF-1 ENFORCEMENT (the load-bearing invariant of this package): a FeeSchedule is
// immutable once an Invoice references it. Every mutating operation calls
// ensureMutable(), which refuses with ErrFeeScheduleImmutable when EITHER:
//  1. the schedule's `locked` flag is true (set when the first invoice issues), OR
//  2. one or more academy_invoices rows already reference the schedule
//     (CountReferencingInvoices > 0) — a belt-and-braces check so the guard holds even
//     if a caller somehow issued an invoice without setting `locked`.
//
// This lives in the SERVICE layer (not only the DB trigger) per build-spec §4 SF-1.
//
// SF-6: fee_items + installment_policy are captured at Create only and are never exposed
// to any mutation path, so installment terms are part of the immutable schedule.
type Service struct {
	store Store
}

// NewService builds the service over the pgx-backed Repository.
func NewService(db *pgxpool.Pool) *Service { return &Service{store: NewRepository(db)} }

// NewServiceWithStore injects a custom Store (tests).
func NewServiceWithStore(store Store) *Service { return &Service{store: store} }

func parseDate(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, ErrInvalidDate
	}
	return &t, nil
}

// Create publishes a new (unlocked) fee schedule. fee_items + installment_policy are set
// here and only here (SF-6). amountMinor must be > 0.
func (s *Service) Create(ctx context.Context, actorID string, req CreateFeeScheduleRequest) (*FeeSchedule, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, ErrMissingName
	}
	if req.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	due, err := parseDate(req.DueDate)
	if err != nil {
		return nil, err
	}
	fs, err := s.store.Insert(ctx, FeeSchedule{
		SchoolID:          req.SchoolID,
		SessionID:         ptrOrNil(req.SessionID),
		ClassID:           ptrOrNil(req.ClassID),
		ClassCode:         ptrOrNil(req.ClassCode),
		Term:              ptrOrNil(req.Term),
		Name:              req.Name,
		AmountMinor:       req.AmountMinor,
		Currency:          req.Currency,
		FeeItems:          req.FeeItems,
		InstallmentPolicy: req.InstallmentPolicy,
	}, due)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "fee_schedule_created", fs.ID, "", "active",
		map[string]any{"schoolId": req.SchoolID, "amountMinor": req.AmountMinor})
	return fs, nil
}

// Get returns a fee schedule.
func (s *Service) Get(ctx context.Context, id string) (*FeeSchedule, error) {
	return s.store.Get(ctx, id)
}

// List returns a school's fee schedules (optionally filtered by session/class).
func (s *Service) List(ctx context.Context, schoolID, sessionID, classID string) ([]FeeSchedule, error) {
	return s.store.List(ctx, schoolID, sessionID, classID)
}

// ensureMutable is the SF-1 gate. It loads the schedule and refuses ANY mutation when the
// schedule is locked OR already referenced by an invoice. Returns the current schedule so
// callers can avoid a second read.
func (s *Service) ensureMutable(ctx context.Context, id string) (*FeeSchedule, error) {
	cur, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.Locked {
		return nil, ErrFeeScheduleImmutable
	}
	n, err := s.store.CountReferencingInvoices(ctx, id)
	if err != nil {
		return nil, err
	}
	if n > 0 {
		return nil, ErrFeeScheduleImmutable
	}
	return cur, nil
}

// Update edits ONLY name / due_date of an unlocked, unreferenced schedule. If the
// schedule is locked or an invoice references it, the update is refused with
// ErrFeeScheduleImmutable (SF-1). fee_items / installment_policy / amount are never
// editable (SF-6) — they are simply not fields of UpdateFeeScheduleRequest.
func (s *Service) Update(ctx context.Context, actorID, id string, req UpdateFeeScheduleRequest) (*FeeSchedule, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if _, err := s.ensureMutable(ctx, id); err != nil {
		if errors.Is(err, ErrFeeScheduleImmutable) {
			_ = s.store.WriteAudit(ctx, actorID, "fee_schedule_update_rejected", id, "", "",
				map[string]any{"reason": "immutable_locked_or_referenced"})
		}
		return nil, err
	}
	due, err := parseDate(req.DueDate)
	if err != nil {
		return nil, err
	}
	out, err := s.store.UpdateMutable(ctx, id, req.Name, due, req.DueDate != "")
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "fee_schedule_updated", id, "", "", map[string]any{})
	return out, nil
}

// Lock marks the schedule immutable (locked = true). This is called when the first
// invoice issues against the schedule — the cross-service invoice→lock call belongs to
// E2's invoice service (see report), but the flag write lives here so this package owns
// the immutability state. Idempotent.
func (s *Service) Lock(ctx context.Context, actorID, id string) (*FeeSchedule, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	out, err := s.store.Lock(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "fee_schedule_locked", id, "", "locked",
		map[string]any{"reason": "referenced_by_issued_invoice"})
	return out, nil
}
