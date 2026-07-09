package extranet

import (
	"context"
	"errors"
	"time"

	"spotlight/backend/internal/stays/ari"
)

// Sentinel errors.
var (
	ErrForbidden = errors.New("extranet: caller lacks an active grant on this property")
	ErrNotFound  = errors.New("extranet: not found")
)

// Service is the hotelier extranet application layer. It enforces object-level
// authZ (the caller must hold an ACTIVE hotelier grant on the property) on every
// operation, and reuses the ARI engine for inventory re-open when a hotelier
// cancels or marks no-show.
type Service struct {
	repo  *Repository
	authz *AuthZ
	allot ari.Allotment // re-opens allotment on hotel cancel / no-show
}

// NewService constructs the extranet service.
func NewService(repo *Repository, authz *AuthZ, allot ari.Allotment) *Service {
	return &Service{repo: repo, authz: authz, allot: allot}
}

// guard performs the object-level scope check (used by every mutating op).
func (s *Service) guard(ctx context.Context, userID, propertyID string) error {
	if !s.authz.HasProperty(ctx, userID, propertyID) {
		return ErrForbidden
	}
	return nil
}

// MyProperties lists the properties the user may act on (extranet landing).
func (s *Service) MyProperties(ctx context.Context, userID string) ([]map[string]any, error) {
	return s.repo.MyProperties(ctx, userID)
}

// --- content ---

// GetProperty returns the property content (object-scoped).
func (s *Service) GetProperty(ctx context.Context, userID, propertyID string) (Property, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return Property{}, err
	}
	return s.repo.GetProperty(ctx, propertyID)
}

// UpdateContent edits property content (object-scoped). Moderation status is admin-only.
func (s *Service) UpdateContent(ctx context.Context, userID, propertyID, name, desc, address, city string, star int, ptype string) error {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return err
	}
	return s.repo.UpdatePropertyContent(ctx, propertyID, name, desc, address, city, star, ptype)
}

// ListRoomTypes / CreateRoomType (object-scoped).
func (s *Service) ListRoomTypes(ctx context.Context, userID, propertyID string) ([]RoomType, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListRoomTypes(ctx, propertyID)
}

func (s *Service) CreateRoomType(ctx context.Context, userID, propertyID, name string, occ int, bedding string) (string, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return "", err
	}
	return s.repo.CreateRoomType(ctx, propertyID, name, occ, bedding)
}

// ListRatePlans / CreateRatePlan (object-scoped).
func (s *Service) ListRatePlans(ctx context.Context, userID, propertyID string) ([]RatePlan, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListRatePlans(ctx, propertyID)
}

func (s *Service) CreateRatePlan(ctx context.Context, userID, propertyID, roomTypeID, planType, board string, refundable bool, baseKobo int64, currency string) (string, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return "", err
	}
	return s.repo.CreateRatePlan(ctx, propertyID, roomTypeID, planType, board, refundable, baseKobo, currency)
}

// --- reservations dashboard ---

func (s *Service) ListReservations(ctx context.Context, userID, propertyID, state string, limit, offset int) ([]ReservationRow, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListReservations(ctx, propertyID, state, limit, offset)
}

func (s *Service) Arrivals(ctx context.Context, userID, propertyID, date string) ([]ReservationRow, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListArrivals(ctx, propertyID, orDate(date))
}

func (s *Service) Departures(ctx context.Context, userID, propertyID, date string) ([]ReservationRow, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListDepartures(ctx, propertyID, orDate(date))
}

func (s *Service) InHouse(ctx context.Context, userID, propertyID, date string) ([]ReservationRow, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListInHouse(ctx, propertyID, orDate(date))
}

func (s *Service) ReservationDetail(ctx context.Context, userID, propertyID, reservationID string) (ReservationDetail, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return ReservationDetail{}, err
	}
	return s.repo.GetReservationDetail(ctx, propertyID, reservationID)
}

// MarkNoShow transitions the reservation to NO_SHOW and re-opens the held allotment
// (so the room can be re-sold). Money handling (no-show penalty/charge) stays with
// the guest-side saga + admin settlement; this is the operational state change.
func (s *Service) MarkNoShow(ctx context.Context, userID, propertyID, reservationID string) error {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return err
	}
	if err := s.repo.MarkNoShow(ctx, reservationID, propertyID); err != nil {
		return err
	}
	s.releaseAllotment(ctx, reservationID)
	return nil
}

// CancelByHotel cancels a reservation on the hotel's side and re-opens the allotment.
func (s *Service) CancelByHotel(ctx context.Context, userID, propertyID, reservationID, reason string) error {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return err
	}
	if err := s.repo.CancelByHotel(ctx, reservationID, propertyID, reason); err != nil {
		return err
	}
	s.releaseAllotment(ctx, reservationID)
	return nil
}

// releaseAllotment best-effort re-opens inventory for a cancelled/no-show stay.
func (s *Service) releaseAllotment(ctx context.Context, reservationID string) {
	if s.allot == nil {
		return
	}
	rt, ci, co, rooms, err := s.repo.RoomTypeOfReservation(ctx, reservationID)
	if err != nil || rt == "" {
		return
	}
	in, e1 := time.Parse("2006-01-02", ci)
	out, e2 := time.Parse("2006-01-02", co)
	if e1 != nil || e2 != nil {
		return
	}
	_ = s.allot.AllotmentRelease(ctx, rt, ari.DateRange{CheckIn: in, CheckOut: out}, rooms)
}

// --- messaging (guest <-> hotel thread) ---

// PostMessage persists a HOST message on a reservation's thread. Object-scoped: the
// caller must hold an ACTIVE grant on the property AND the reservation must belong to
// that property. Returns the persisted row (not a stub).
func (s *Service) PostMessage(ctx context.Context, userID, propertyID, reservationID, body string) (Message, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return Message{}, err
	}
	ok, err := s.repo.ReservationBelongsToProperty(ctx, reservationID, propertyID)
	if err != nil {
		return Message{}, err
	}
	if !ok {
		return Message{}, ErrNotFound
	}
	if body == "" {
		return Message{}, errors.New("extranet: message body required")
	}
	return s.repo.InsertMessage(ctx, reservationID, propertyID, "host", userID, body)
}

// ListMessages returns a reservation's thread. Object-scoped as above.
func (s *Service) ListMessages(ctx context.Context, userID, propertyID, reservationID string) ([]Message, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	ok, err := s.repo.ReservationBelongsToProperty(ctx, reservationID, propertyID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return s.repo.ListMessages(ctx, reservationID, 200)
}

// --- finance reads ---

func (s *Service) Payouts(ctx context.Context, userID, propertyID string) ([]PayoutRow, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListPayouts(ctx, propertyID, 100)
}

func (s *Service) Commission(ctx context.Context, userID, propertyID string) ([]CommissionRow, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	return s.repo.ListCommission(ctx, propertyID, 100)
}

// --- analytics ---

func (s *Service) Analytics(ctx context.Context, userID, propertyID, from, to string) (Analytics, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return Analytics{}, err
	}
	return s.repo.ComputeAnalytics(ctx, propertyID, from, to)
}

// --- account / staff ---

func (s *Service) ListStaff(ctx context.Context, userID, propertyID string) ([]StaffRow, error) {
	// Staff management is OWNER/MANAGER only (object-scoped role check).
	if !s.authz.HasPropertyRole(ctx, userID, propertyID, "OWNER", "MANAGER") {
		return nil, ErrForbidden
	}
	return s.repo.ListStaff(ctx, propertyID)
}

func (s *Service) UpsertStaff(ctx context.Context, actorUserID, propertyID, targetUserID, role, status string) error {
	if !s.authz.HasPropertyRole(ctx, actorUserID, propertyID, "OWNER", "MANAGER") {
		return ErrForbidden
	}
	return s.repo.UpsertStaff(ctx, propertyID, targetUserID, role, status)
}

func orDate(d string) string {
	if d == "" {
		return time.Now().Format("2006-01-02")
	}
	return d
}
