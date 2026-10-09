package disputes

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const (
	keyError = "error"
)

// FoodDisputeResolver performs the module-specific resolution for a food-delivery
// dispute — the real refund-cap (non-tip basis, ADR-031) + rider tip-clawback logic
// that lives in internal/restaurant — when a food dispute reaches this generic
// module's AdminResolve. Injected by the wiring layer (see WithFoodResolver) so this
// package never imports internal/restaurant directly.
// FOOD-004: before this existed, Resolve() bare-flipped the status column for every
// module_type, including "food" — silently no-op'ing the refund/clawback the admin
// console's own request implied. See Resolve.
type FoodDisputeResolver interface {
	ResolveGenericDispute(ctx context.Context, disputeID, adminID, resolution string, refundKobo int64, note string) error
}

// ErrDisputeNotResolvable and ErrDisputeForbidden are translations of the delegated
// resolver's own typed errors (e.g. internal/restaurant's ErrDisputeInvalid /
// ErrForbidden), so this package's handler can map them to 422 / 403 instead of a
// blanket 500 without importing the resolver's package. The wiring layer that builds
// the FoodDisputeResolver is expected to wrap its errors with these via %w.
var (
	ErrDisputeNotResolvable = errors.New("disputes: dispute cannot be resolved as requested")
	ErrDisputeForbidden     = errors.New("disputes: not authorized to resolve this dispute")
)

// Service manages dispute lifecycle.
type Service struct {
	db           *pgxpool.Pool
	foodResolver FoodDisputeResolver
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// WithFoodResolver wires the restaurant module's real dispute-resolution logic in for
// module_type=="food" disputes. Returns the Service for chaining, matching the rest of
// this codebase's WithX wiring convention.
func (s *Service) WithFoodResolver(r FoodDisputeResolver) *Service {
	s.foodResolver = r
	return s
}

// Open creates a new dispute ticket.
func (s *Service) Open(ctx context.Context, userID string, req OpenRequest) (*Dispute, error) {
	d := &Dispute{
		ID:          uuid.New().String(),
		UserID:      userID,
		Reference:   req.Reference,
		ModuleType:  req.ModuleType,
		Type:        req.Type,
		Description: req.Description,
		Status:      StatusOpen,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	const insert = `
		INSERT INTO disputes (id, user_id, reference, module_type, type, description, status)
		VALUES ($1,$2,$3,$4,$5,$6,'open')`
	_, err := s.db.Exec(ctx, insert, d.ID, d.UserID, d.Reference, d.ModuleType, string(d.Type), d.Description)
	if err != nil {
		return nil, fmt.Errorf("disputes: open: %w", err)
	}
	return d, nil
}

// List returns disputes for a user, newest first.
func (s *Service) List(ctx context.Context, userID string, limit, offset int) ([]Dispute, error) {
	const q = `
		SELECT id, user_id, reference, module_type, type, description, status, created_at, updated_at
		FROM disputes WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Dispute
	for rows.Next() {
		var d Dispute
		var typ, status string
		if err := rows.Scan(&d.ID, &d.UserID, &d.Reference, &d.ModuleType, &typ, &d.Description, &status, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		d.Type = DisputeType(typ)
		d.Status = Status(status)
		out = append(out, d)
	}
	return out, rows.Err()
}

// Resolve is called by admin to close a dispute. For most module_types this is a bare
// status update — no money moves through this generic path today, and that has never
// been the case for any module (see FOOD-004 below), so that behavior is preserved
// unchanged here.
// module_type=="food" is the one exception with a REAL, already-built refund/clawback
// implementation (internal/restaurant's AdminResolveFoodDispute) that this endpoint
// used to bypass entirely — resolving a food dispute with resolution=refunded and a
// refund_kobo amount flipped the ticket to "resolved" and moved zero money (FOOD-004).
// Dispatching to the injected FoodDisputeResolver instead of the bare update fixes
// that without adding a second, redundant set of food-specific routes: the frontend
// keeps calling this same endpoint.
// Fails closed rather than silently no-op'ing: a food dispute with no resolver wired
// returns an error instead of pretending to resolve it.
func (s *Service) Resolve(ctx context.Context, disputeID string, resolution Resolution, adminNote string, refundKobo int64, adminID string) error {
	moduleType, err := s.moduleTypeOf(ctx, disputeID)
	if err != nil {
		return err
	}
	if moduleType == "food" {
		if s.foodResolver == nil {
			return fmt.Errorf("%w: food dispute resolution is not wired (no FoodDisputeResolver)", ErrDisputeNotResolvable)
		}
		return s.foodResolver.ResolveGenericDispute(ctx, disputeID, adminID, string(resolution), refundKobo, adminNote)
	}
	const update = `
		UPDATE disputes
		SET status='resolved', resolution=$2, admin_note=$3, updated_at=NOW()
		WHERE id=$1`
	_, err = s.db.Exec(ctx, update, disputeID, string(resolution), adminNote)
	return err
}

// moduleTypeOf reads the discriminator that decides how a dispute is resolved.
func (s *Service) moduleTypeOf(ctx context.Context, disputeID string) (string, error) {
	var moduleType string
	if err := s.db.QueryRow(ctx, `SELECT module_type FROM disputes WHERE id=$1`, disputeID).Scan(&moduleType); err != nil {
		return "", fmt.Errorf("%w: dispute not found: %w", ErrDisputeNotResolvable, err)
	}
	return moduleType, nil
}

// Status mirrors the disputes lifecycle.
type Status string

const (
	StatusOpen     Status = "open"
	StatusInReview Status = "in_review"
	StatusResolved Status = "resolved"
	StatusClosed   Status = "closed"
)

// Resolution is how the dispute was resolved.
type Resolution string

const (
	ResolutionRefunded  Resolution = "refunded"
	ResolutionSettled   Resolution = "settled"
	ResolutionDismissed Resolution = "dismissed"
)

// DisputeType describes what the dispute is about.
type DisputeType string

const (
	TypeFailedPayment DisputeType = "failed_payment"
	TypeNonDelivery   DisputeType = "non_delivery"
	TypeWrongItem     DisputeType = "wrong_item"
	TypeNoShow        DisputeType = "no_show"
	TypeFakeCampaign  DisputeType = "fake_campaign"
	TypeUnauthorised  DisputeType = "unauthorised"
	TypeOther         DisputeType = "other"
)

// Dispute is a formal complaint raised against a transaction or order.
type Dispute struct {
	ID           string      `json:"id"`
	UserID       string      `json:"user_id"`     // reporter
	Reference    string      `json:"reference"`   // transaction / order ref
	ModuleType   string      `json:"module_type"` // food | transport | wallet | etc.
	Type         DisputeType `json:"type"`
	Description  string      `json:"description"`
	EvidenceURLs []string    `json:"evidence_urls,omitempty"`
	Status       Status      `json:"status"`
	Resolution   *Resolution `json:"resolution,omitempty"`
	AdminNote    *string     `json:"admin_note,omitempty"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}

// OpenRequest is the body for POST /finance/disputes.
type OpenRequest struct {
	Reference   string      `json:"reference" binding:"required"`
	ModuleType  string      `json:"module_type" binding:"required"`
	Type        DisputeType `json:"type" binding:"required"`
	Description string      `json:"description" binding:"required,min=20"`
}

type Handler struct{ svc *Service }

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusForbidden, ErrDisputeForbidden),
	httperr.R(http.StatusUnprocessableEntity, ErrDisputeNotResolvable),
)

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Open handles POST /api/finance/disputes
func (h *Handler) Open(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req OpenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.Open(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, d)
}

// List handles GET /api/finance/disputes
func (h *Handler) List(c *gin.Context) {
	userID := ginutil.UserID(c)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	disputes, err := h.svc.List(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": disputes, "count": len(disputes)})
}

// AdminResolve handles POST /api/finance/admin/disputes/:id/resolve.
// refund_kobo is REQUIRED for module_type=="food" (see Service.Resolve /
// FOOD-004) — it must be unmarshalled here or the refund path dead-ends.
func (h *Handler) AdminResolve(c *gin.Context) {
	adminID := ginutil.UserID(c)
	disputeID := c.Param("id")
	var body struct {
		Resolution string `json:"resolution" binding:"required"`
		AdminNote  string `json:"admin_note"`
		RefundKobo int64  `json:"refund_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.Resolve(c.Request.Context(), disputeID, Resolution(body.Resolution), body.AdminNote, body.RefundKobo, adminID); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"resolved": true, "dispute_id": disputeID})
}
