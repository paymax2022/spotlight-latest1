package schools

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the Spotlight Academy B2B2C institutions domain. It owns:
//   - the GUARDED licence lifecycle SM (active↔suspended → expired),
//   - SEAT-CAPPED, IDEMPOTENT bulk enrolment (used_seats ≤ seats, atomic per learner),
//   - institution billing via the INJECTED BillingRail (finance/va — no vendor leak).
//
// Money NEVER moves here directly: the value movement for billing is delegated to the
// injected BillingRail (paymax-rails.md §Virtual accounts). This module only flips LOCAL
// billing state once the rail confirms, and every guarded transition is audited to
// public.audit_logs (module 'academy.schools').
type Service struct {
	repo    Store
	billing BillingRail
	// reader is the concrete pgx repository, used ONLY by the additive admin-wide
	// oversight reads (all licences / class groups / billing, overview aggregate) which
	// need queries beyond the Store contract. nil in the test seam (newServiceWithStore),
	// which never exercises those admin reads.
	reader *Repository
}

// NewService wires the schools service from a pgx pool. A nil rail falls back to the
// deterministic dev stub so the package runs end-to-end without a vendor bound.
func NewService(db *pgxpool.Pool, billing BillingRail) *Service {
	if billing == nil {
		billing = StubBillingRail{}
	}
	repo := NewRepository(db)
	return &Service{repo: repo, billing: billing, reader: repo}
}

// newServiceWithStore is the test seam: inject a fake Store + rail (no DB).
func newServiceWithStore(repo Store, billing BillingRail) *Service {
	if billing == nil {
		billing = StubBillingRail{}
	}
	return &Service{repo: repo, billing: billing}
}

// parseDate parses a YYYY-MM-DD string into *time.Time (nil for empty).
func parseDate(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, ErrInvalidInput
	}
	return &t, nil
}

// ── Institutions ──────────────────────────────────────────────────────────────────

// OnboardInstitution registers a B2B2C institution (admin). whiteLabel is the
// logo/colors/domain config blob (stored as jsonb).
func (s *Service) OnboardInstitution(ctx context.Context, adminID string, req OnboardInstitutionRequest) (*Institution, error) {
	if req.Name == "" {
		return nil, ErrInvalidInput
	}
	typ := req.Type
	if typ == "" {
		typ = "school"
	}
	if typ != "school" && typ != "institution" {
		return nil, ErrInvalidInput
	}
	inst, err := s.repo.InsertInstitution(ctx, req.Name, typ, req.AdminUserID, req.WhiteLabel, req.VirtualAccountRef)
	if err != nil {
		return nil, err
	}
	_ = s.repo.WriteAudit(ctx, adminID, "institution.onboarded", "academy_institution", inst.ID,
		map[string]any{"name": inst.Name, "type": inst.Type, "adminUserId": req.AdminUserID})
	return inst, nil
}

func (s *Service) ListInstitutions(ctx context.Context) ([]Institution, error) {
	return s.repo.ListInstitutions(ctx)
}

// MyInstitutions returns the institutions a user administers (school-admin-lite view).
func (s *Service) MyInstitutions(ctx context.Context, userID string) ([]Institution, error) {
	if userID == "" {
		return nil, ErrNotFound
	}
	return s.repo.ListInstitutionsByAdmin(ctx, userID)
}

// ── Admin-wide oversight reads (all institutions) ──────────────────────────────────

// AdminOverview aggregates platform-wide institution/licence/seat/enrolment totals for
// the admin console (composed from the additive all-institutions oversight queries).
func (s *Service) AdminOverview(ctx context.Context) (*AdminOverview, error) {
	institutions, licences, activeLicences, seatsTotal, seatsUsed, err := s.reader.OverviewTotals(ctx)
	if err != nil {
		return nil, err
	}
	enrollments, err := s.reader.CountAllEnrollmentsByState(ctx)
	if err != nil {
		return nil, err
	}
	if enrollments == nil {
		enrollments = map[string]int{}
	}
	return &AdminOverview{
		Institutions:   institutions,
		Licences:       licences,
		ActiveLicences: activeLicences,
		SeatsTotal:     seatsTotal,
		SeatsUsed:      seatsUsed,
		Enrollments:    enrollments,
	}, nil
}

// AdminListLicences lists ALL licences across every institution.
func (s *Service) AdminListLicences(ctx context.Context) ([]Licence, error) {
	return s.reader.ListAllLicences(ctx)
}

// AdminListClassGroups lists ALL class groups across every institution (flat list).
func (s *Service) AdminListClassGroups(ctx context.Context) ([]ClassGroup, error) {
	return s.reader.ListAllClassGroups(ctx)
}

// AdminListBilling lists ALL institution billing/invoice lines across every institution.
func (s *Service) AdminListBilling(ctx context.Context) ([]Billing, error) {
	return s.reader.ListAllBilling(ctx)
}

// ── Licences ──────────────────────────────────────────────────────────────────────

// IssueLicence issues a licence (active) for an institution with a seat cap and price.
func (s *Service) IssueLicence(ctx context.Context, adminID string, req IssueLicenceRequest) (*Licence, error) {
	if req.Tier == "" || req.Seats <= 0 {
		return nil, ErrInvalidInput
	}
	if req.PriceMinor < 0 {
		return nil, ErrInvalidAmount
	}
	inst, err := s.repo.GetInstitution(ctx, req.InstitutionID)
	if err != nil {
		return nil, err
	}
	if inst.Status != "active" {
		return nil, ErrInstitutionInactive
	}
	startsAt, err := parseDate(req.StartsAt)
	if err != nil {
		return nil, err
	}
	expiresAt, err := parseDate(req.ExpiresAt)
	if err != nil {
		return nil, err
	}
	lic, err := s.repo.InsertLicence(ctx, req.InstitutionID, req.Tier, req.Seats, req.PriceMinor, startsAt, expiresAt)
	if err != nil {
		return nil, err
	}
	_ = s.repo.WriteAudit(ctx, adminID, "licence.issued", "academy_licence", lic.ID,
		map[string]any{"institutionId": req.InstitutionID, "tier": lic.Tier, "seats": lic.Seats, "priceMinor": lic.PriceMinor})
	return lic, nil
}

// transitionLicence is the GUARDED licence-SM helper: pre-check canLicence, apply the
// atomic state change, audit (illegal transitions are rejected AND audited).
func (s *Service) transitionLicence(ctx context.Context, adminID, licenceID string, from, to LicenceState, action string) (*Licence, error) {
	if !canLicence(from, to) {
		_ = s.repo.WriteAudit(ctx, adminID, action+"_rejected", "academy_licence", licenceID,
			map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"})
		return nil, ErrIllegalTransition
	}
	lic, err := s.repo.SetLicenceState(ctx, licenceID, from, to)
	if err != nil {
		if errors.Is(err, ErrIllegalTransition) {
			_ = s.repo.WriteAudit(ctx, adminID, action+"_rejected", "academy_licence", licenceID,
				map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"})
		}
		return nil, err
	}
	_ = s.repo.WriteAudit(ctx, adminID, action, "academy_licence", licenceID,
		map[string]any{"from": string(from), "to": string(to)})
	return lic, nil
}

// SuspendLicence: active → suspended.
func (s *Service) SuspendLicence(ctx context.Context, adminID, licenceID string) (*Licence, error) {
	return s.transitionLicence(ctx, adminID, licenceID, LicenceActive, LicenceSuspended, "licence.suspended")
}

// ReactivateLicence: suspended → active.
func (s *Service) ReactivateLicence(ctx context.Context, adminID, licenceID string) (*Licence, error) {
	return s.transitionLicence(ctx, adminID, licenceID, LicenceSuspended, LicenceActive, "licence.reactivated")
}

// ExpireLicence: active|suspended → expired. The current state is read first so the
// guard matches whichever live state the licence is in.
func (s *Service) ExpireLicence(ctx context.Context, adminID, licenceID string) (*Licence, error) {
	lic, err := s.repo.GetLicence(ctx, licenceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrLicenceNotFound
		}
		return nil, err
	}
	return s.transitionLicence(ctx, adminID, licenceID, lic.State, LicenceExpired, "licence.expired")
}

// ── Class groups ────────────────────────────────────────────────────────────────

func (s *Service) CreateClassGroup(ctx context.Context, adminID string, req CreateClassGroupRequest) (*ClassGroup, error) {
	if req.Name == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.repo.GetInstitution(ctx, req.InstitutionID); err != nil {
		return nil, err
	}
	g, err := s.repo.InsertClassGroup(ctx, req.InstitutionID, req.Name, req.ClassCode, req.TeacherUserID)
	if err != nil {
		return nil, err
	}
	_ = s.repo.WriteAudit(ctx, adminID, "class_group.created", "academy_class_group", g.ID,
		map[string]any{"institutionId": req.InstitutionID, "name": g.Name})
	return g, nil
}

// ── Bulk enrolment (seat-capped + idempotent) ─────────────────────────────────────

// BulkEnroll enrols a batch of learners into an institution (optionally a class group).
// Per learner the enrolment is ATOMIC and:
//   - IDEMPOTENT: a learner already enrolled is reported under alreadyEnrolled and
//     consumes NO new seat (replay-safe — re-running the same batch double-seats nobody).
//   - SEAT-CAPPED: used_seats is incremented under a FOR UPDATE lock on the active
//     licence and may never exceed seats. When the cap is reached the run STOPS and
//     returns ErrSeatLimitExceeded together with how many learners were seated.
func (s *Service) BulkEnroll(ctx context.Context, adminID string, req BulkEnrollRequest, idemKey string) (*BulkEnrollResult, error) {
	if len(req.LearnerIDs) == 0 {
		return nil, ErrInvalidInput
	}
	inst, err := s.repo.GetInstitution(ctx, req.InstitutionID)
	if err != nil {
		return nil, err
	}
	if inst.Status != "active" {
		return nil, ErrInstitutionInactive
	}

	res := &BulkEnrollResult{Enrolled: []string{}, AlreadyEnrolled: []string{}}
	for i, learner := range req.LearnerIDs {
		if learner == "" {
			continue
		}
		// Per-learner idempotency key keeps each enrol replay-safe within the batch.
		perKey := scopedKey(idemKey, req.InstitutionID, learner)
		seated, replay, used, seats, e := s.repo.EnrollSeated(ctx, req.InstitutionID, req.ClassGroupID, learner, perKey)
		res.UsedSeats, res.Seats = used, seats
		switch {
		case e == nil && replay:
			res.AlreadyEnrolled = append(res.AlreadyEnrolled, learner)
		case e == nil && seated:
			res.Enrolled = append(res.Enrolled, learner)
			res.Succeeded++
		case errors.Is(e, ErrSeatLimitExceeded):
			// Cap reached: stop, report how many succeeded so far. The remaining learners
			// (this one included) are NOT enrolled.
			res.SeatLimitHit = true
			_ = s.repo.WriteAudit(ctx, adminID, "enrollment.seat_limit_exceeded", "academy_institution", req.InstitutionID,
				map[string]any{"succeeded": res.Succeeded, "usedSeats": used, "seats": seats,
					"stoppedAt": learner, "remaining": len(req.LearnerIDs) - i})
			return res, ErrSeatLimitExceeded
		default:
			return res, e
		}
	}
	_ = s.repo.WriteAudit(ctx, adminID, "enrollment.bulk", "academy_institution", req.InstitutionID,
		map[string]any{"succeeded": res.Succeeded, "alreadyEnrolled": len(res.AlreadyEnrolled),
			"usedSeats": res.UsedSeats, "seats": res.Seats, "classGroupId": req.ClassGroupID})
	return res, nil
}

// RemoveEnrollment removes a learner (active→removed) and frees a seat.
func (s *Service) RemoveEnrollment(ctx context.Context, adminID, institutionID, learnerUserID string) error {
	if institutionID == "" || learnerUserID == "" {
		return ErrInvalidInput
	}
	freed, err := s.repo.RemoveEnrollment(ctx, institutionID, learnerUserID)
	if err != nil {
		return err
	}
	if freed {
		_ = s.repo.WriteAudit(ctx, adminID, "enrollment.removed", "academy_institution", institutionID,
			map[string]any{"learnerUserId": learnerUserID})
	}
	return nil
}

// ── Billing (generate → charge via rail) ──────────────────────────────────────────

// GenerateBilling opens a billing line for a period (admin). amountMinor is the charge
// that the rail will collect on ChargeBilling.
func (s *Service) GenerateBilling(ctx context.Context, adminID string, req GenerateBillingRequest) (*Billing, error) {
	if req.Period == "" {
		return nil, ErrInvalidInput
	}
	if req.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	if _, err := s.repo.GetInstitution(ctx, req.InstitutionID); err != nil {
		return nil, err
	}
	b, err := s.repo.InsertBilling(ctx, req.InstitutionID, req.Period, req.AmountMinor)
	if err != nil {
		return nil, err
	}
	_ = s.repo.WriteAudit(ctx, adminID, "billing.generated", "academy_institution_billing", b.ID,
		map[string]any{"institutionId": req.InstitutionID, "period": b.Period, "amountMinor": b.AmountMinor})
	return b, nil
}

// ChargeBilling charges an OPEN billing line via the INJECTED BillingRail and flips it
// open→paid. Idempotent: the rail is idempotent on idemKey, and the local open→paid
// guard ensures the line is charged ONCE — a replay of an already-paid line returns the
// paid line with no second charge.
func (s *Service) ChargeBilling(ctx context.Context, adminID, billingID, idemKey string) (*Billing, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	b, err := s.repo.GetBilling(ctx, billingID)
	if err != nil {
		return nil, err
	}
	if b.State == BillingPaid {
		return b, nil // already charged — idempotent success, no second charge
	}
	if b.State != BillingOpen {
		return nil, ErrBillingNotOpen
	}
	inst, err := s.repo.GetInstitution(ctx, b.InstitutionID)
	if err != nil {
		return nil, err
	}
	instRef := ""
	if inst.VirtualAccountRef != nil {
		instRef = *inst.VirtualAccountRef
	}
	// Money via RAIL (idempotent on idemKey). The rail owns value movement; we only flip
	// local state once it confirms.
	payRef, err := s.billing.Charge(ctx, instRef, billingID, idemKey, b.AmountMinor)
	if err != nil {
		return nil, err
	}
	paid, err := s.repo.SetBillingPaid(ctx, billingID, payRef)
	if err != nil {
		if errors.Is(err, ErrBillingNotOpen) {
			// Lost the race (concurrent charge already flipped it) — return the paid line.
			return s.repo.GetBilling(ctx, billingID)
		}
		return nil, err
	}
	_ = s.repo.WriteAudit(ctx, adminID, "billing.charged", "academy_institution_billing", billingID,
		map[string]any{"institutionId": b.InstitutionID, "amountMinor": b.AmountMinor, "paymentRef": payRef})
	return paid, nil
}

// ── Overview ──────────────────────────────────────────────────────────────────────

// GetInstitution returns the institution overview: licences (with seat usage), class
// groups and enrolment counts by state.
func (s *Service) GetInstitution(ctx context.Context, institutionID string) (*Overview, error) {
	inst, err := s.repo.GetInstitution(ctx, institutionID)
	if err != nil {
		return nil, err
	}
	licences, err := s.repo.ListLicences(ctx, institutionID)
	if err != nil {
		return nil, err
	}
	groups, err := s.repo.ListClassGroups(ctx, institutionID)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.CountEnrollmentsByState(ctx, institutionID)
	if err != nil {
		return nil, err
	}
	seats := make([]LicenceSeats, 0, len(licences))
	var total, used int
	for _, l := range licences {
		seats = append(seats, LicenceSeats{LicenceID: l.ID, Tier: l.Tier, State: l.State, Seats: l.Seats, UsedSeats: l.UsedSeats})
		if l.State == LicenceActive {
			total += l.Seats
			used += l.UsedSeats
		}
	}
	if counts == nil {
		counts = map[string]int{}
	}
	return &Overview{
		Institution: inst, Licences: licences, Seats: seats,
		SeatsTotal: total, SeatsUsed: used, ClassGroups: groups, EnrollmentCount: counts,
	}, nil
}

// ── helpers ─────────────────────────────────────────────────────────────────────

// scopedKey derives a stable per-learner idempotency key from the batch key. When no
// batch key is supplied it falls back to the (institution, learner) pair so the
// enrolment is still idempotent on the natural unique constraint.
func scopedKey(idemKey, institutionID, learner string) string {
	if idemKey == "" {
		return "enroll:" + institutionID + ":" + learner
	}
	return idemKey + ":" + learner
}
