package transport

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/platform/ws"
)

type Handler struct {
	svc           *Service
	tracker       *TripTracker
	hub           *ws.Hub
	presigner     *r2.Presigner // optional; nil/unconfigured disables presigned uploads
	presignBucket string
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithRealtime attaches the live trip-tracking hub + tracker (real-time GPS).
func (h *Handler) WithRealtime(tracker *TripTracker, hub *ws.Hub) *Handler {
	h.tracker = tracker
	h.hub = hub
	return h
}

// ServeTripWS upgrades to a WebSocket on the authenticated user's channel. The
// client receives "trip.position" messages for any trip it participates in (we
// only push to the trip's rider + driver), so no per-trip subscription is needed.
func (h *Handler) ServeTripWS(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime not configured"})
		return
	}
	_ = h.hub.ServeHTTP(c.Writer, c.Request, uid)
}

// TrackPosition ingests one driver GPS sample for a trip and fans the snapped
// position out to the rider + driver in real time. Driver-only.
func (h *Handler) TrackPosition(c *gin.Context) {
	uid := ginutil.UserID(c)
	tripID := c.Param("id")
	if h.tracker == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime not configured"})
		return
	}
	var p TrackPoint
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.tracker.Ingest(c.Request.Context(), tripID, uid, p); err != nil {
		if errors.Is(err, ErrNotTripDriver) {
			c.JSON(http.StatusForbidden, gin.H{"error": httperr.Msg(c, http.StatusForbidden, err), "code": "not_trip_driver"})
			return
		}
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true})
}

// ListMessages returns a trip's chat thread. Reachable by both the rider
// (/mobility/trips/:id/messages) and the driver (/driver/trips/:id/messages)
// — object-level authz in Service.ListMessages is the only real gate.
func (h *Handler) ListMessages(c *gin.Context) {
	uid := ginutil.UserID(c)
	msgs, err := h.svc.ListMessages(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": msgs})
}

// SendMessage posts one chat message and broadcasts it over the trip WS.
func (h *Handler) SendMessage(c *gin.Context) {
	uid := ginutil.UserID(c)
	var req SendTripMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	tripID := c.Param("id")
	m, err := h.svc.SendMessage(c.Request.Context(), tripID, uid, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	if h.tracker != nil {
		h.tracker.BroadcastMessage(c.Request.Context(), tripID, m)
	}
	c.JSON(http.StatusCreated, gin.H{"message": m})
}

// respondErr maps a service error to the right HTTP status + machine code.
// CodedError carries an explicit status/code; everything else is a 500.
func respondErr(c *gin.Context, err error) {
	var ce *CodedError
	if errors.As(err, &ce) {
		c.JSON(ce.Status, gin.H{"error": ce.Message, "code": ce.Code})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
}

func (h *Handler) RegisterDriver(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req RegisterDriverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.RegisterDriver(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Handler) SetStatus(c *gin.Context) {
	userID := ginutil.UserID(c)
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.SetDriverStatus(c.Request.Context(), userID, DriverStatus(body.Status)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) RequestTrip(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req RequestTripRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	trip, err := h.svc.RequestTrip(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, trip)
}

func (h *Handler) AcceptTrip(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.AcceptTrip(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) UpdateStatus(c *gin.Context) {
	userID := ginutil.UserID(c)
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.UpdateTripStatus(c.Request.Context(), c.Param("id"), userID, TripStatus(body.Status)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// OnboardingSubmit moves a driver to verification_status submitted.
func (h *Handler) OnboardingSubmit(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req OnboardingSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.SubmitOnboarding(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// AddDocument uploads a driver document.
func (h *Handler) AddDocument(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req DocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	doc, err := h.svc.AddDocument(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, doc)
}

// AddVehicle registers a vehicle for the driver.
func (h *Handler) AddVehicle(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req VehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	v, err := h.svc.AddVehicle(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

// DriverMe returns the full driver profile.
func (h *Handler) DriverMe(c *gin.Context) {
	userID := ginutil.UserID(c)
	d, err := h.svc.DriverMeFull(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// DriverStatus toggles online/offline + updates location (approved-only online).
func (h *Handler) DriverStatus(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req DriverStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.SetDriverOnline(c.Request.Context(), userID, req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

// DriverRequests returns open ride requests near the driver.
func (h *Handler) DriverRequests(c *gin.Context) {
	userID := ginutil.UserID(c)
	reqs, err := h.svc.OpenRequests(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// DriverAccept accepts a request at the standing fare.
func (h *Handler) DriverAccept(c *gin.Context) {
	userID := ginutil.UserID(c)
	detail, err := h.svc.DriverAccept(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

// DriverCounter records a driver counter-offer.
func (h *Handler) DriverCounter(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CounterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	fo, err := h.svc.DriverCounter(c.Request.Context(), c.Param("id"), userID, req.CounterKobo)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, fo)
}

// DriverArrive: driver_assigned → driver_arriving.
func (h *Handler) DriverArrive(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.DriverArrive(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhaseDriverArriving)})
}

// VerifyPin: driver_arriving → pin_verified.
func (h *Handler) VerifyPin(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req VerifyPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.VerifyPin(c.Request.Context(), c.Param("id"), userID, req.Pin); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhasePinVerified)})
}

// StartTrip: pin_verified → in_progress.
func (h *Handler) StartTrip(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.StartTrip(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhaseInProgress)})
}

// CompleteTrip: in_progress → completed, settles the split.
func (h *Handler) CompleteTrip(c *gin.Context) {
	userID := ginutil.UserID(c)
	tripID := c.Param("id")
	if err := h.svc.CompleteTrip(c.Request.Context(), tripID, userID); err != nil {
		respondErr(c, err)
		return
	}
	resp := gin.H{"ok": true, "phase": string(PhaseCompleted)}
	// Best-effort enrichment so the driver app can render accurate cash-trip
	// copy (fee debited, not credited) — never fails the completion itself.
	if summary, err := h.svc.CompletionSummary(c.Request.Context(), tripID); err == nil {
		maps.Copy(resp, summary)
	}
	c.JSON(http.StatusOK, resp)
}

// DriverEarnings returns the driver economic dashboard.
func (h *Handler) DriverEarnings(c *gin.Context) {
	userID := ginutil.UserID(c)
	e, err := h.svc.Earnings(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, e)
}

// DriverSOS creates a driver-side safety incident.
func (h *Handler) DriverSOS(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req SOSRequest
	_ = c.ShouldBindJSON(&req)
	inc, err := h.svc.CreateIncident(c.Request.Context(), userID, "sos", req.TripID, req.Lat, req.Lng, req.Description, "critical")
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, inc)
}

// TripMessage is one chat message between a trip's two participants (the
// rider and the assigned driver). SenderRole is derived from the sender's
// relation to the trip. This is separate from the trip PIN: the PIN is an
// at-the-door identity check the driver enters; chat is free-form pre-arrival
// logistics ("I'm outside", "which gate", "is this the right address").
type TripMessage struct {
	ID            string    `json:"id"`
	TripID        string    `json:"trip_id"`
	SenderID      string    `json:"sender_id"`
	SenderRole    string    `json:"sender_role"`
	Body          string    `json:"body"`
	AttachmentURL *string   `json:"attachment_url,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// SendTripMessageRequest is the body for POST .../messages.
type SendTripMessageRequest struct {
	Body          string  `json:"body" binding:"required,min=1,max=4000"`
	AttachmentURL *string `json:"attachment_url,omitempty"`
}

// tripParties resolves a trip's rider and (if assigned) driver user id, for
// object-level authz — the sole gate for who may read or post to trip chat.
func (s *Service) tripParties(ctx context.Context, tripID string) (string, string, error) {
	var riderID string
	var driverUserID string

	var driverRowID *string
	if err := s.db.QueryRow(ctx, `SELECT rider_id, driver_id FROM trips WHERE id=$1`, tripID).Scan(&riderID, &driverRowID); err != nil {
		return "", "", codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if driverRowID != nil {
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *driverRowID).Scan(&driverUserID)
	}
	return riderID, driverUserID, nil
}

// ListMessages returns a trip's chat thread, oldest first. Caller must be the
// rider or the assigned driver.
func (s *Service) ListMessages(ctx context.Context, tripID, userID string) ([]TripMessage, error) {
	riderID, driverUserID, err := s.tripParties(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if userID != riderID && (driverUserID == "" || userID != driverUserID) {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a participant of this trip")
	}
	const q = `SELECT id, trip_id, sender_id, sender_role, body, attachment_url, created_at
	           FROM trip_messages WHERE trip_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TripMessage
	for rows.Next() {
		var m TripMessage
		if err := rows.Scan(&m.ID, &m.TripID, &m.SenderID, &m.SenderRole, &m.Body, &m.AttachmentURL, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SendMessage posts a chat message scoped to the trip's two participants. The
// sender role is derived from the user's relation to the trip; the message is
// returned so the HTTP layer can broadcast it over the trip WS and notify the
// counterparty (transport.Service has no WS dependency of its own — see
// Handler.SendMessage, which owns the realtime hub).
func (s *Service) SendMessage(ctx context.Context, tripID, senderID string, req SendTripMessageRequest) (*TripMessage, error) {
	riderID, driverUserID, err := s.tripParties(ctx, tripID)
	if err != nil {
		return nil, err
	}
	var role string
	switch senderID {
	case riderID:
		role = "rider"
	case driverUserID:
		if driverUserID == "" {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a participant of this trip")
		}
		role = "driver"
	default:
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a participant of this trip")
	}

	m := &TripMessage{
		ID:            uuid.New().String(),
		TripID:        tripID,
		SenderID:      senderID,
		SenderRole:    role,
		Body:          req.Body,
		AttachmentURL: req.AttachmentURL,
		CreatedAt:     time.Now(),
	}
	const ins = `INSERT INTO trip_messages (id, trip_id, sender_id, sender_role, body, attachment_url)
	             VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, ins, m.ID, m.TripID, m.SenderID, m.SenderRole, m.Body, m.AttachmentURL); err != nil {
		return nil, fmt.Errorf("transport: insert trip message: %w", err)
	}
	return m, nil
}

// Backend-owned presigned Cloudflare R2 uploads for driver documents.
// The mobile driver-onboarding flow (features/mobility) needs to upload a licence,
// insurance certificate, roadworthiness certificate, etc. before submitting the
// resulting object key via POST /driver/documents. A client-supplied file_url
// string would be untrusted, so:
//  1. Client calls POST /api/finance/driver/documents/presign with the snake_case
//     body {doc_type, file_name, mime_type}.
//  2. Backend derives a SERVER-CONTROLLED object key
//     (drivers/<userID>/documents/<docType>/<rand>-<sanitizedFileName>) and returns
//     a short-lived presigned PUT URL + the file (object) key as camelCase
//     {uploadUrl, fileUrl}.
//  3. Client PUTs the binary directly to R2, then submits fileUrl via the existing
//     POST /driver/documents endpoint.
// The client cannot choose an arbitrary key (no overwriting another driver's
// objects), and the Content-Type is bound into the signature (no type smuggling).
// R2 credentials are server-side only; when R2 is unconfigured the endpoint fails
// closed with 503 rather than fabricating a URL (mirrors estate.PresignUpload).

// driverPresignTTL bounds how long an issued upload URL is valid.
const driverPresignTTL = 10 * time.Minute

// driverDocTypes is the allowed set of driver document types. It matches the
// mobile DocType union (features/mobility/types) and also accepts the broader
// transport document vocabulary so newer clients are not rejected.
var driverDocTypes = map[string]bool{
	// mobile DocType union
	"drivers_licence":   true,
	"government_id":     true,
	"proof_of_address":  true,
	"vehicle_insurance": true,
	"roadworthiness":    true,
	// broader transport document vocabulary
	"license":         true,
	"vehicle_reg":     true,
	"insurance":       true,
	"road_worthiness": true,
	"lasrra":          true,
	"psv":             true,
	"profile_photo":   true,
}

// driverAllowedUploadContentTypes restricts what a presigned PUT may upload
// (bound into the signature, so the client must send exactly this Content-Type).
var driverAllowedUploadContentTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/webp":      true,
	"application/pdf": true,
}

// WithPresigner attaches an R2 presigner so the driver-document upload endpoint
// can mint short-lived presigned PUT URLs. A nil or unconfigured presigner makes
// the endpoint fail closed with 503.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// DriverDocPresignRequest is the snake_case body for
// POST /driver/documents/presign.
type DriverDocPresignRequest struct {
	DocType  string `json:"doc_type" binding:"required"`
	FileName string `json:"file_name" binding:"required"`
	MimeType string `json:"mime_type" binding:"required"`
}

// DriverDocPresignResponse is the camelCase body the mobile client consumes: it
// PUTs the binary to UploadURL, then persists FileURL (the object key) via the
// existing POST /driver/documents endpoint.
type DriverDocPresignResponse struct {
	UploadURL string `json:"uploadUrl"` // presigned PUT URL (short-lived)
	FileURL   string `json:"fileUrl"`   // server-chosen object key to echo back on submit
}

// PresignDriverDocument issues a presigned R2 PUT URL scoped to the authenticated
// driver for a document upload.
// POST /api/finance/driver/documents/presign
func (h *Handler) PresignDriverDocument(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
		return
	}

	var req DriverDocPresignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	docType := strings.ToLower(strings.TrimSpace(req.DocType))
	if !driverDocTypes[docType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported document type"})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.MimeType))
	if !driverAllowedUploadContentTypes[ct] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported content type"})
		return
	}
	fileName := sanitizeUploadFileName(req.FileName)
	if fileName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file name"})
		return
	}

	// Server-controlled key: client cannot influence the path beyond its own scope.
	// The random component prevents guessing/overwrite.
	key := fmt.Sprintf("drivers/%s/documents/%s/%s-%s", userID, docType, cryptox.RandHex(16), fileName)

	url, err := h.presigner.PresignPut(key, ct, driverPresignTTL)
	if err != nil {
		if errors.Is(err, r2.ErrNotConfigured) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue upload url"})
		return
	}

	c.JSON(http.StatusOK, DriverDocPresignResponse{
		UploadURL: url,
		FileURL:   key,
	})
}

// sanitizeUploadFileName reduces a client-supplied file name to its base name and
// keeps only a safe character set, so it cannot alter the object-key path.
func sanitizeUploadFileName(name string) string {
	base := path.Base(strings.TrimSpace(name))
	if base == "." || base == "/" || base == ".." {
		return ""
	}
	var b strings.Builder
	for i := range len(base) {
		c := base[i]
		switch {
		case c >= 'A' && c <= 'Z',
			c >= 'a' && c <= 'z',
			c >= '0' && c <= '9',
			c == '-', c == '_', c == '.':
			b.WriteByte(c)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}
