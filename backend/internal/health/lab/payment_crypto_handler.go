package healthlab

import (
	"errors"
	"net/http"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/tiers"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type cryptoOrderReq struct {
	LabProviderID     string   `json:"lab_provider_id"`
	CollectionMethod  string   `json:"collection_method"`
	TestIDs           []string `json:"test_ids"`
	PackageIDs        []string `json:"package_ids"`
	ExpectedTotalKobo *int64   `json:"expected_total_kobo"`
	CollectionAddress string   `json:"collection_address"`
	CollectionLat     *float64 `json:"collection_lat"`
	CollectionLng     *float64 `json:"collection_lng"`
	ScheduledFor      string   `json:"scheduled_for"`
	AssetID           string   `json:"asset_id"`
	MaxUnits          int64    `json:"max_units"`
}

// bindCryptoOrder validates the shared body; it writes the 4xx and returns false on failure.
func bindCryptoOrder(c *gin.Context) (cryptoOrderReq, CreateOrderInput, bool) {
	var req cryptoOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return req, CreateOrderInput{}, false
	}
	for name, v := range map[string]string{"lab_provider_id": req.LabProviderID, "asset_id": req.AssetID} {
		if _, err := uuid.Parse(v); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, name+" must be a uuid")
			return req, CreateOrderInput{}, false
		}
	}
	for _, id := range append(append([]string{}, req.TestIDs...), req.PackageIDs...) {
		if _, err := uuid.Parse(id); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "test_ids and package_ids must be uuids")
			return req, CreateOrderInput{}, false
		}
	}
	scheduledFor, ok := parseScheduledFor(req.ScheduledFor)
	if !ok {
		ginutil.FailOK(c, http.StatusBadRequest, "scheduled_for must be an RFC 3339 time")
		return req, CreateOrderInput{}, false
	}
	return req, CreateOrderInput{
		LabProviderID:     req.LabProviderID,
		CollectionMethod:  CollectionMethod(req.CollectionMethod),
		TestIDs:           req.TestIDs,
		PackageIDs:        req.PackageIDs,
		ExpectedTotalKobo: req.ExpectedTotalKobo,
		CollectionAddress: req.CollectionAddress,
		CollectionLat:     req.CollectionLat,
		CollectionLng:     req.CollectionLng,
		ScheduledFor:      scheduledFor,
	}, true
}

func failCrypto(c *gin.Context, err error) {
	var changed *QuoteChangedError
	switch {
	case errors.As(err, &changed):
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": err.Error(), "quote": changed.Quote})
	case errors.Is(err, ErrCryptoUnavailable):
		failErr(c, http.StatusServiceUnavailable, err)
	case errors.Is(err, ErrCryptoQuoteMoved), errors.Is(err, ErrIdemConflict):
		failErr(c, http.StatusConflict, err)
	case errors.Is(err, ErrEmptyOrder), errors.Is(err, ErrOrderTooLarge), errors.Is(err, ErrDuplicateItem), errors.Is(err, ErrCryptoAsset):
		failErr(c, http.StatusBadRequest, err)
	case errors.Is(err, tiers.ErrWalletDisabled), errors.Is(err, tiers.ErrDailyLimitExceeded):
		failErr(c, http.StatusForbidden, err)
	case errors.Is(err, escrow.ErrTierGateUnwired):
		failErr(c, http.StatusServiceUnavailable, err)
	default:
		failErr(c, http.StatusUnprocessableEntity, err)
	}
}

// QuoteCryptoPayment — POST /orders/crypto-quote  (patient; read-only)
// Prices the order in an asset: units required at the live price (+ buffer) and
// a 30 s advisory expiry. No money moves.
func (h *Handler) QuoteCryptoPayment(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	req, in, ok := bindCryptoOrder(c)
	if !ok {
		return
	}
	q, err := h.svc.QuoteCryptoPayment(c.Request.Context(), id, in, req.AssetID)
	if err != nil {
		failCrypto(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "quote": q})
}

// PayWithCrypto — POST /orders/pay-crypto  (patient; Idempotency-Key REQUIRED)
// Sells units of the asset into the patient's wallet, then creates the order
// with its payment HELD in escrow (the order's "paid" state — see payment_crypto.go).
func (h *Handler) PayWithCrypto(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	key, ok := ginutil.RequireIdempotencyKey(c)
	if !ok {
		return
	}
	req, in, ok := bindCryptoOrder(c)
	if !ok {
		return
	}
	in.IdempotencyKey = key
	res, err := h.svc.PayWithCrypto(c.Request.Context(), id, in, req.AssetID, req.MaxUnits)
	if err != nil {
		failCrypto(c, err)
		return
	}
	status := http.StatusCreated
	if res.Replayed {
		status = http.StatusOK
	}
	c.JSON(status, gin.H{"success": true, "result": res})
}
