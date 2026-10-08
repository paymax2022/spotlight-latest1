package realtor

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/estate"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

const keyError = "error"

// Admin handler (HTTP). Mounted under /api/realtor/admin with RBAC.
// RBAC-gated by the `realtor.manage` permission (fail-closed). Every mutation is
// written to realtor_admin_audit_log. Mirrors internal/invest/admin.go.

type AdminHandler struct{ repo *Repository }

func NewAdminHandler(repo *Repository) *AdminHandler { return &AdminHandler{repo: repo} }

// adminID reads the authenticated admin's user id set by the auth middleware.
func adminID(c *gin.Context) string {
	if au, ok := middleware.GetAuthenticatedUser(c); ok && au.ID != "" {
		return au.ID
	}
	return c.GetString("user_id")
}

// Overview returns the headline dashboard counts/aggregates. The admin client
// reads the object directly (RealtorOverview).
func (h *AdminHandler) Overview(c *gin.Context) {
	out, err := h.repo.Overview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, out)
}

// PendingListings returns the moderation queue. The admin client unwraps `.data`.
func (h *AdminHandler) PendingListings(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	listings, err := h.repo.PendingListings(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": listings})
}

// DecideListing applies an approve/reject/changes_requested moderation decision.
// Audited to realtor_admin_audit_log. No money moves here — moderation only.
func (h *AdminHandler) DecideListing(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if !isValidListingDecision(body.Decision) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "decision must be one of approved, rejected, changes_requested"})
		return
	}
	beforeStatus, beforeVerification, err := h.repo.GetListingStatus(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keyError: "listing not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	newStatus, err := h.repo.DecideListing(c.Request.Context(), id, body.Decision)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keyError: "listing not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	_ = h.repo.InsertAudit(c.Request.Context(), adminID(c), "listing.decision", "listing", id, body.Reason,
		gin.H{"status": beforeStatus, "verification": beforeVerification},
		gin.H{"decision": body.Decision, "status": newStatus})
	c.JSON(http.StatusOK, gin.H{"id": id, "status": newStatus})
}

// PendingVerifications returns the verification queue. Client unwraps `.data`.
func (h *AdminHandler) PendingVerifications(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	reqs, err := h.repo.PendingVerifications(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": reqs})
}

// DecideVerification applies an approve/reject/more_info verification decision.
// Audited. No money moves here — trust-&-safety verification only.
func (h *AdminHandler) DecideVerification(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if !isValidVerificationStatus(body.Status) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "status must be one of approved, rejected, more_info"})
		return
	}
	if err := h.repo.DecideVerification(c.Request.Context(), id, body.Status); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keyError: "verification subject not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	_ = h.repo.InsertAudit(c.Request.Context(), adminID(c), "verification.decision", "listing", id, body.Reason,
		nil, gin.H{"status": body.Status})
	c.JSON(http.StatusOK, gin.H{"id": id, "status": body.Status})
}

// Payments lists realtor payments (read-only). Client unwraps `.data`.
func (h *AdminHandler) Payments(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	payments, err := h.repo.Payments(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": payments})
}

// Escrow lists escrow deposits (read-only). Client unwraps `.data`.
func (h *AdminHandler) Escrow(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	escrow, err := h.repo.Escrow(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": escrow})
}

// ResolveEscrow is the money-moving admin endpoint for inspection-gated deposit
// release/forfeiture (PROPMGMT-002): it requires a submitted realtor_move_outs
// record for the lease, and every branch is audited to realtor_admin_audit_log
// by the repository method.
func (h *AdminHandler) ResolveEscrow(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	result, err := h.repo.ResolveEscrow(c.Request.Context(), id, body.Decision, body.Note, adminID(c))
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{keyError: "escrow deposit not found"})
		case errors.Is(err, ErrInvalidEscrowDecision):
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, ErrInvalidEscrowDecision)})
		case errors.Is(err, ErrEscrowAlreadyResolved):
			c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, ErrEscrowAlreadyResolved)})
		case errors.Is(err, ErrMoveOutRequired):
			c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, ErrMoveOutRequired)})
		case errors.Is(err, ErrLedgerNotConfigured):
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, ErrLedgerNotConfigured)})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		}
		return
	}
	c.JSON(http.StatusOK, result)
}

func adminPage(c *gin.Context, def int) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(def)))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 200 {
		limit = def
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func isValidListingDecision(d string) bool {
	switch d {
	case "approved", "rejected", "changes_requested":
		return true
	}
	return false
}

func isValidVerificationStatus(s string) bool {
	switch s {
	case "approved", "rejected", "more_info":
		return true
	}
	return false
}

// RealtorManagePermission is the RBAC slug required to reach the realtor admin
// control plane. Grant it to Property-Ops / Trust-&-Safety / Finance / Super-Admin
// roles via the RBAC UI (seeded for super-admin by migration
// 20260621060000_realtor_admin_rbac.sql).
const RealtorManagePermission = "realtor.manage"

// Deps carries the collaborators needed to wire the realtor admin control plane.
type Deps struct {
	DB       *pgxpool.Pool
	Supabase *integrations.SupabaseRestClient
	RBAC     services.RBACService
	Ledger   *ledger.Service // required for the escrow resolve (release/forfeit) money path
	Enabled  bool            // FEATURE_REALTOR_ENABLED
}

// Register mounts the realtor admin control-plane routes under /api/realtor/admin.
// The mobile/marketplace data plane is served directly from Supabase + RPCs; this
// module only exposes the admin control plane (overview, moderation, verification,
// payments, escrow). RBAC-gated and audited.
func Register(r *gin.Engine, d Deps) {
	if !d.Enabled {
		log.Println("[realtor] FEATURE_REALTOR_ENABLED is false — skipping admin routes")
		return
	}
	if d.DB == nil {
		log.Println("[realtor] no database pool — skipping admin routes")
		return
	}

	repo := NewRepository(d.DB, d.Ledger)
	ah := NewAdminHandler(repo)

	// authn maps the authenticated user's id into the gin context key handlers
	// read (matches the finance/invest modules' user_id convention).
	authn := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(d.Supabase, d.RBAC)
	}

	// RBAC-gated: requires the `realtor.manage` permission (fail-closed). Every
	// mutation is written to realtor_admin_audit_log by the handlers.
	admin := r.Group("/api/realtor/admin")
	admin.Use(authn())
	admin.Use(middleware.RequirePermission(d.RBAC, RealtorManagePermission))
	{
		admin.GET("/overview", ah.Overview)
		admin.GET("/listings/pending", ah.PendingListings)
		admin.POST("/listings/:id/decision", ah.DecideListing)
		admin.GET("/verifications", ah.PendingVerifications)
		admin.POST("/verifications/:id/decision", ah.DecideVerification)
		admin.GET("/payments", ah.Payments)
		admin.GET("/escrow", ah.Escrow)
		admin.POST("/escrow/:id/resolve", ah.ResolveEscrow)
	}

	log.Println("[realtor] admin control plane registered at /api/realtor/admin")
}

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

// loadBooking resolves the booking plus its estate id, taken ONLY from the
// unit's estate link (realtor_listings → realtor_units). The booking row's own
// estate_id column is deliberately NOT consulted: guests hold FOR-ALL UPDATE
// rights on their booking rows, so b.estate_id is attacker-writable — trusting
// it let a guest book their own shortlet, overwrite estate_id with a victim
// estate, and mint a real visitor pass for an estate they have no
// relationship to.
func (s *StaysService) loadBooking(ctx context.Context, bookingID string) (*bookingRow, error) {
	const q = `
		SELECT b.user_id::TEXT, b.guest_name, b.check_in, b.check_out, b.status,
		       u.estate_id::TEXT AS estate_id,
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

	if b.PassID != nil && *b.PassID != "" {
		return s.estate.GetVisitorPass(ctx, *b.EstateID, *b.PassID)
	}

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
	callerID := ginutil.UserID(c)
	if callerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "authentication required"})
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
		c.JSON(http.StatusNotFound, gin.H{keyError: "no gate pass for this booking"})
		return
	}
	c.JSON(http.StatusOK, pass)
}
