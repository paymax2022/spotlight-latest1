package healthlab

import (
	"errors"
	"net/http"
	"time"

	"spotlight/backend/go-common/ginutil"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func fieldFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrOrderNotFound), errors.Is(err, ErrNoPhlebotomist):
		failErr(c, http.StatusNotFound, err)
	case errors.Is(err, ErrBadBarcode), errors.Is(err, ErrChecklistIncomplete),
		errors.Is(err, ErrBadCollectionInput), errors.Is(err, ErrBadCollectionStatus):
		failErr(c, http.StatusBadRequest, err)
	case errors.Is(err, ErrBarcodeMismatch), errors.Is(err, ErrBarcodeInUse):
		failErr(c, http.StatusConflict, err)
	default:
		failOrder(c, http.StatusConflict, err)
	}
}

// ListAssignments — GET /phlebotomist/assignments?lat=&lng=
func (h *Handler) ListAssignments(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	lat, ok := optFloat(c, "lat", -90, 90)
	if !ok {
		return
	}
	lng, ok := optFloat(c, "lng", -180, 180)
	if !ok {
		return
	}
	if (lat == nil) != (lng == nil) {
		ginutil.FailOK(c, http.StatusBadRequest, "lat and lng must be supplied together")
		return
	}
	rows, err := h.svc.ListAssignments(c.Request.Context(), uid, lat, lng)
	if err != nil {
		fieldFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "assignments": rows})
}

// SetCollectionStatus — POST /phlebotomist/assignments/:id/status {status, lat, lng}
func (h *Handler) SetCollectionStatus(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	var in struct {
		Status string   `json:"status"`
		Lat    *float64 `json:"lat"`
		Lng    *float64 `json:"lng"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SetCollectionStatus(c.Request.Context(), uid, id, in.Status, in.Lat, in.Lng); err != nil {
		fieldFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetChecklist — GET /phlebotomist/assignments/:id/checklist
func (h *Handler) GetChecklist(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	items, err := h.svc.GetChecklist(c.Request.Context(), uid, id)
	if err != nil {
		fieldFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "items": items})
}

// LogCustody — POST /phlebotomist/assignments/:id/custody
func (h *Handler) LogCustody(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	var in struct {
		Barcode        string   `json:"barcode"`
		ConditionOK    bool     `json:"condition_ok"`
		Note           string   `json:"note"`
		CompletedItems []string `json:"completed_items"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	sampleID, breach, err := h.svc.LogCustody(c.Request.Context(), uid, id, in.Barcode, in.ConditionOK, in.Note, in.CompletedItems)
	if err != nil {
		fieldFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "sample_id": sampleID, "breach": breach})
}

// DropOff — POST /phlebotomist/assignments/:id/drop-off
func (h *Handler) DropOff(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	var in struct {
		LabID   string `json:"lab_id"`
		Barcode string `json:"barcode"`
		Note    string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if in.LabID != "" {
		if _, err := uuid.Parse(in.LabID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "lab_id must be a uuid")
			return
		}
	}
	if err := h.svc.DropOff(c.Request.Context(), uid, id, in.LabID, in.Barcode, in.Note); err != nil {
		fieldFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// OrderPhlebotomist — GET /orders/:id/phlebotomist  (patient, owning lab, admin)
func (h *Handler) OrderPhlebotomist(c *gin.Context) {
	uid, ok := resultsUser(c)
	if !ok {
		return
	}
	id, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	v, err := h.svc.OrderPhlebotomist(c.Request.Context(), uid, id, h.isAdmin(c))
	if err != nil {
		fieldFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "phlebotomist": v})
}

// parseScheduledFor parses an optional RFC 3339 time; a malformed value is a 400.
func parseScheduledFor(raw string) (*time.Time, bool) {
	if raw == "" {
		return nil, true
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, false
	}
	return &t, true
}
