package realtor

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/estate"
)

// EstatePassIssuer is the seam onto the estate module's system pass-issuance and
// pass-read functions. *estate.Service satisfies it. Keeping it an interface lets
// the realtor module call across the module boundary without a hard build-time
// coupling to estate internals.
type EstatePassIssuer interface {
	IssueSystemVisitorPass(ctx context.Context, req estate.SystemPassRequest) (*estate.VisitorPass, error)
	GetVisitorPass(ctx context.Context, estateID, passID string) (*estate.VisitorPass, error)
}

// StaysService implements the stay→gate-pass bridge (cross-cutting flow #4): when a
// confirmed shortlet/hotel booking is for a unit that physically sits inside a
// managed estate, it auto-issues an estate visitor gate pass for the guest covering
// the stay dates, reusing the estate pass-issuance seam (no logic duplication).
//
// There is no Go-side booking-confirm hook (bookings are created via the Supabase
// realtor RPCs), so issuance is performed lazily and idempotently on first read of
// the gate pass: the booking row records estate_pass_id once issued.
type StaysService struct {
	db     *pgxpool.Pool
	estate EstatePassIssuer
}

func NewStaysService(db *pgxpool.Pool, est EstatePassIssuer) *StaysService {
	return &StaysService{db: db, estate: est}
}

// ErrNoGatePass means the booking exists but is not in a managed estate (no pass).
var ErrNoGatePass = errors.New("realtor: booking is not in a managed estate")

type bookingRow struct {
	UserID    string
	GuestName string
	CheckIn   time.Time
	CheckOut  time.Time
	Status    string
	EstateID  *string
	PassID    *string
}

// loadBooking resolves the booking plus its effective estate id. The estate is the
// booking's explicit estate_id override, else the unit's estate_id reached via
// realtor_listings → realtor_units.
func (s *StaysService) loadBooking(ctx context.Context, bookingID string) (*bookingRow, error) {
	const q = `
		SELECT b.user_id::TEXT, b.guest_name, b.check_in, b.check_out, b.status,
		       COALESCE(b.estate_id, u.estate_id)::TEXT AS estate_id,
		       b.estate_pass_id::TEXT
		FROM realtor_shortlet_bookings b
		JOIN realtor_listings l ON l.id = b.listing_id
		JOIN realtor_units    u ON u.id = l.unit_id
		WHERE b.id = $1`
	var r bookingRow
	var estateID, passID *string
	if err := s.db.QueryRow(ctx, q, bookingID).Scan(
		&r.UserID, &r.GuestName, &r.CheckIn, &r.CheckOut, &r.Status, &estateID, &passID,
	); err != nil {
		return nil, err
	}
	r.EstateID = estateID
	r.PassID = passID
	return &r, nil
}

// GetOrIssueGatePass returns the auto-issued estate visitor pass for a booking,
// issuing it on first call if the booking is confirmed/checked-in and sits inside a
// managed estate. Idempotent: the pass id is persisted on the booking row, so a
// second call returns the same pass.
//
// callerID is the authenticated user; access is allowed when the caller is the
// booking's guest. (Estate guard/admin access is enforced separately at the route
// layer via the estate membership of the pass's estate — see route comment.)
func (s *StaysService) GetOrIssueGatePass(ctx context.Context, bookingID, callerID string, isEstateStaff bool) (*estate.VisitorPass, error) {
	b, err := s.loadBooking(ctx, bookingID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoGatePass
		}
		return nil, err
	}
	// Authorization: the booking guest, or an estate guard/admin.
	if b.UserID != callerID && !isEstateStaff {
		return nil, ErrNoGatePass
	}
	if b.EstateID == nil || *b.EstateID == "" {
		return nil, ErrNoGatePass // not in a managed estate → 404 at the handler.
	}

	// Already issued → return it.
	if b.PassID != nil && *b.PassID != "" {
		return s.estate.GetVisitorPass(ctx, *b.EstateID, *b.PassID)
	}

	// Only issue for live stays.
	if b.Status != "confirmed" && b.Status != "checked_in" {
		return nil, ErrNoGatePass
	}

	pass, err := s.estate.IssueSystemVisitorPass(ctx, estate.SystemPassRequest{
		EstateID:    *b.EstateID,
		VisitorName: b.GuestName,
		Purpose:     "Short-stay guest",
		// A gate pass should be valid from the day of check-in to the day of
		// check-out (inclusive of the checkout day's daytime).
		ValidFrom:  b.CheckIn,
		ValidUntil: b.CheckOut.Add(24 * time.Hour),
		Source:     "realtor.shortlet",
		SourceRef:  bookingID,
	})
	if err != nil {
		return nil, err
	}

	// Persist the link so issuance is one-shot (idempotent on subsequent reads).
	_, _ = s.db.Exec(ctx,
		`UPDATE realtor_shortlet_bookings SET estate_pass_id=$1 WHERE id=$2 AND estate_pass_id IS NULL`,
		pass.ID, bookingID)

	return pass, nil
}

// StaysHandler is the HTTP surface for the stay→gate-pass bridge.
type StaysHandler struct {
	svc *StaysService
}

func NewStaysHandler(svc *StaysService) *StaysHandler { return &StaysHandler{svc: svc} }

// GetGatePass → GET /api/finance/realtor/stays/:bookingId/gate-pass
// Returns the auto-issued estate visitor pass for the booking, or 404 when the
// booking is not in a managed estate / no pass applies.
func (h *StaysHandler) GetGatePass(c *gin.Context) {
	callerID := c.GetString("user_id")
	if callerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	bookingID := c.Param("bookingId")
	// Estate ops staff (holders of the estate.manage permission) may view any
	// booking's gate pass at the gate; otherwise access is restricted to the
	// booking's own guest. The flag is set by a non-blocking upstream middleware
	// (see the route registration in finance_routes.go), so a guest without the
	// permission is still served as the booking owner rather than rejected.
	isEstateStaff := c.GetBool("property_estate_staff")
	pass, err := h.svc.GetOrIssueGatePass(c.Request.Context(), bookingID, callerID, isEstateStaff)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no gate pass for this booking"})
		return
	}
	c.JSON(http.StatusOK, pass)
}
