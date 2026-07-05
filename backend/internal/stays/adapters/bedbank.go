package adapters

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"spotlight/backend/internal/stays/gateway"
)

// BedbankAdapter is the Rail A (bedbank / aggregator) supply adapter. It implements
// gateway.SupplyGateway against a supplier sandbox over HTTP with HMAC auth. It
// surfaces NET rates from the supplier; the Paymax markup is applied ABOVE the
// adapter by the pricing engine (the adapter never invents the sell price).
//
// Keys come from config/secrets via New(); they are NEVER hard-coded and NEVER
// logged. The HTTP layer mirrors internal/provider/{paystack,mycover}.
// TODO(live): swap the sandbox base URL + confirm the supplier's request/response
// shapes, auth header, and HMAC scheme against the chosen Rail-A supplier
// (RateHawk / ZentrumHub — PRD §28 C). Until then this runs against a stub/sandbox.
type BedbankAdapter struct {
	supplierCode string // e.g. "ratehawk" — stable supplier id surfaced on offers
	apiKey       string // secret key — server-to-server auth; never logged
	apiSecret    string // HMAC signing secret; never logged
	baseURL      string
	httpClient   *http.Client
}

// defaultBedbankBaseURL is the sandbox base URL. The live URL is injected via
// config in production. TODO(live): confirm the production base URL.
const defaultBedbankBaseURL = "https://sandbox.bedbank.example/v1"

// NewBedbank constructs a Rail-A adapter. baseURL may be empty to use the sandbox.
func NewBedbank(supplierCode, apiKey, apiSecret, baseURL string) *BedbankAdapter {
	if supplierCode == "" {
		supplierCode = "bedbank-sandbox"
	}
	if baseURL == "" {
		baseURL = defaultBedbankBaseURL
	}
	return &BedbankAdapter{
		supplierCode: supplierCode,
		apiKey:       apiKey,
		apiSecret:    apiSecret,
		baseURL:      baseURL,
		httpClient:   &http.Client{Timeout: 20 * time.Second},
	}
}

// Name returns the stable adapter id used by the Router registry.
func (a *BedbankAdapter) Name() string { return "bedbank" }

// --- gateway.SupplyGateway ---

func (a *BedbankAdapter) Search(ctx context.Context, req gateway.SearchRequest) ([]gateway.PropertyOffer, error) {
	body := map[string]any{
		"city":      req.City,
		"lat":       req.Lat,
		"lng":       req.Lng,
		"check_in":  req.CheckIn.Format("2006-01-02"),
		"check_out": req.CheckOut.Format("2006-01-02"),
		"rooms":     req.Rooms,
		"currency":  req.Currency,
	}
	var resp searchResponse
	// TODO(live): confirm Rail-A search path + payload shape.
	if err := a.post(ctx, "/search", body, &resp); err != nil {
		return nil, err
	}
	if !resp.OK() {
		return nil, fmt.Errorf("bedbank: search: %s", resp.Message)
	}
	offers := make([]gateway.PropertyOffer, 0, len(resp.Data))
	for _, h := range resp.Data {
		offers = append(offers, gateway.PropertyOffer{
			Rail:                gateway.RailBedbank,
			SupplierCode:        a.supplierCode,
			SupplierPropertyRef: h.PropertyRef,
			Name:                h.Name,
			City:                h.City,
			Address:             h.Address,
			Lat:                 h.Lat,
			Lng:                 h.Lng,
			StarRating:          h.Star,
			PropertyType:        h.Type,
			SupplierRoomTypeRef: h.RoomTypeRef,
			RoomName:            h.RoomName,
			RatePlan: gateway.RatePlan{
				SupplierRatePlanRef: h.RatePlanRef,
				Type:                gateway.RatePlanType(h.RatePlanType),
				Board:               h.Board,
				Refundable:          h.Refundable,
				CancellationPolicy:  h.CancellationPolicy,
			},
			NetRateKobo: h.NetRateMinor, // supplier net rate (markup applied above)
			TaxKobo:     h.TaxMinor,
			Currency:    h.Currency,
			OfferToken:  h.OfferToken,
			ExpiresAt:   parseTime(h.ExpiresAt),
		})
	}
	return offers, nil
}

func (a *BedbankAdapter) GetContent(ctx context.Context, supplierPropertyRef string) (gateway.PropertyContent, error) {
	var resp contentResponse
	if err := a.get(ctx, "/content/"+supplierPropertyRef, &resp); err != nil {
		return gateway.PropertyContent{}, err
	}
	if !resp.OK() {
		return gateway.PropertyContent{}, fmt.Errorf("bedbank: content: %s", resp.Message)
	}
	return gateway.PropertyContent{
		SupplierPropertyRef: supplierPropertyRef,
		Name:                resp.Data.Name,
		Description:         resp.Data.Description,
		Address:             resp.Data.Address,
		City:                resp.Data.City,
		Lat:                 resp.Data.Lat,
		Lng:                 resp.Data.Lng,
		StarRating:          resp.Data.Star,
		PropertyType:        resp.Data.Type,
		Amenities:           resp.Data.Amenities,
		Photos:              resp.Data.Photos,
	}, nil
}

// Prebook re-checks live price + availability and returns a short-lived book_token.
// This is the two-step gate: a price drift sets Changed; sold-out sets SoldOut.
func (a *BedbankAdapter) Prebook(ctx context.Context, req gateway.PrebookRequest) (gateway.PrebookResult, error) {
	body := map[string]any{
		"property_ref":  req.SupplierPropertyRef,
		"room_type_ref": req.SupplierRoomTypeRef,
		"rate_plan_ref": req.SupplierRatePlanRef,
		"offer_token":   req.OfferToken,
		"check_in":      req.CheckIn.Format("2006-01-02"),
		"check_out":     req.CheckOut.Format("2006-01-02"),
		"rooms":         req.Rooms,
		"currency":      req.Currency,
	}
	var resp prebookResponse
	// TODO(live): confirm Rail-A prebook path + that it returns a book_token.
	if err := a.post(ctx, "/prebook", body, &resp); err != nil {
		return gateway.PrebookResult{}, err
	}
	if !resp.OK() {
		return gateway.PrebookResult{}, fmt.Errorf("bedbank: prebook: %s", resp.Message)
	}
	return gateway.PrebookResult{
		BookToken:          resp.Data.BookToken,
		NetRateKobo:        resp.Data.NetRateMinor,
		TaxKobo:            resp.Data.TaxMinor,
		Currency:           resp.Data.Currency,
		Changed:            resp.Data.PriceChanged,
		SoldOut:            resp.Data.SoldOut,
		CancellationPolicy: resp.Data.CancellationPolicy,
		ExpiresAt:          parseTime(resp.Data.ExpiresAt),
	}, nil
}

// Book consumes the book_token and is idempotent on Idempotency-Key + book_token —
// a retried book returns the same supplier reservation, never a second booking.
func (a *BedbankAdapter) Book(ctx context.Context, req gateway.BookRequest) (gateway.Reservation, error) {
	body := map[string]any{
		"book_token": req.BookToken,
		"guest": map[string]any{
			"first_name": req.Guest.FirstName,
			"last_name":  req.Guest.LastName,
			"email":      req.Guest.Email,
			"phone":      req.Guest.Phone,
		},
		"guest_ref": req.GuestRef, // opaque ref, NOT the auth user id
		"currency":  req.Currency,
	}
	var resp reservationResponse
	// TODO(live): confirm Rail-A honours Idempotency-Key on book.
	if err := a.postIdem(ctx, "/book", req.IdempotencyKey, body, &resp); err != nil {
		return gateway.Reservation{}, err
	}
	if !resp.OK() {
		// A supplier rejection is BOOK_REJECTED_BY_SUPPLIER (PRD §28 A) — the saga
		// must auto-release the held funds.
		return gateway.Reservation{}, fmt.Errorf("bedbank: book rejected: %s", resp.Message)
	}
	return resp.toReservation(), nil
}

func (a *BedbankAdapter) GetReservation(ctx context.Context, supplierRef string) (gateway.Reservation, error) {
	var resp reservationResponse
	if err := a.get(ctx, "/reservations/"+supplierRef, &resp); err != nil {
		return gateway.Reservation{}, err
	}
	if !resp.OK() {
		return gateway.Reservation{}, fmt.Errorf("bedbank: get reservation: %s", resp.Message)
	}
	return resp.toReservation(), nil
}

func (a *BedbankAdapter) Cancel(ctx context.Context, req gateway.CancelRequest) (gateway.Cancellation, error) {
	body := map[string]any{"reason": req.Reason}
	var resp cancelResponse
	// Idempotent on the cancel idempotency key — retries no-op.
	if err := a.postIdem(ctx, "/reservations/"+req.SupplierRef+"/cancel", req.IdempotencyKey, body, &resp); err != nil {
		return gateway.Cancellation{}, err
	}
	if !resp.OK() {
		return gateway.Cancellation{}, fmt.Errorf("bedbank: cancel: %s", resp.Message)
	}
	return gateway.Cancellation{
		SupplierRef:     req.SupplierRef,
		Status:          resp.Data.Status,
		RefundKobo:      resp.Data.RefundMinor,
		PenaltyKobo:     resp.Data.PenaltyMinor,
		Currency:        resp.Data.Currency,
		CancellationRef: resp.Data.CancellationRef,
	}, nil
}

func (a *BedbankAdapter) Modify(ctx context.Context, req gateway.ModifyRequest) (gateway.Reservation, error) {
	body := map[string]any{
		"check_in":  req.NewCheckIn.Format("2006-01-02"),
		"check_out": req.NewCheckOut.Format("2006-01-02"),
	}
	var resp reservationResponse
	if err := a.postIdem(ctx, "/reservations/"+req.SupplierRef+"/modify", req.IdempotencyKey, body, &resp); err != nil {
		return gateway.Reservation{}, err
	}
	if !resp.OK() {
		return gateway.Reservation{}, fmt.Errorf("bedbank: modify: %s", resp.Message)
	}
	return resp.toReservation(), nil
}

// SyncARI is not supported on the bedbank rail (Rail A is live-search, not push).
func (a *BedbankAdapter) SyncARI(ctx context.Context, ev gateway.ARIEvent) error {
	return gateway.ErrUnsupported
}

// --- supplier JSON shapes (never leak past this file) ---

type bbEnvelope struct {
	Status  bool   `json:"status"`
	Message string `json:"message"`
}

func (e bbEnvelope) OK() bool { return e.Status }

type searchResponse struct {
	bbEnvelope
	Data []struct {
		PropertyRef        string         `json:"property_ref"`
		Name               string         `json:"name"`
		City               string         `json:"city"`
		Address            string         `json:"address"`
		Lat                float64        `json:"lat"`
		Lng                float64        `json:"lng"`
		Star               int            `json:"star"`
		Type               string         `json:"type"`
		RoomTypeRef        string         `json:"room_type_ref"`
		RoomName           string         `json:"room_name"`
		RatePlanRef        string         `json:"rate_plan_ref"`
		RatePlanType       string         `json:"rate_plan_type"`
		Board              string         `json:"board"`
		Refundable         bool           `json:"refundable"`
		CancellationPolicy map[string]any `json:"cancellation_policy"`
		NetRateMinor       int64          `json:"net_rate_minor"`
		TaxMinor           int64          `json:"tax_minor"`
		Currency           string         `json:"currency"`
		OfferToken         string         `json:"offer_token"`
		ExpiresAt          string         `json:"expires_at"`
	} `json:"data"`
}

type contentResponse struct {
	bbEnvelope
	Data struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Address     string   `json:"address"`
		City        string   `json:"city"`
		Lat         float64  `json:"lat"`
		Lng         float64  `json:"lng"`
		Star        int      `json:"star"`
		Type        string   `json:"type"`
		Amenities   []string `json:"amenities"`
		Photos      []string `json:"photos"`
	} `json:"data"`
}

type prebookResponse struct {
	bbEnvelope
	Data struct {
		BookToken          string         `json:"book_token"`
		NetRateMinor       int64          `json:"net_rate_minor"`
		TaxMinor           int64          `json:"tax_minor"`
		Currency           string         `json:"currency"`
		PriceChanged       bool           `json:"price_changed"`
		SoldOut            bool           `json:"sold_out"`
		CancellationPolicy map[string]any `json:"cancellation_policy"`
		ExpiresAt          string         `json:"expires_at"`
	} `json:"data"`
}

type reservationResponse struct {
	bbEnvelope
	Data struct {
		SupplierRef  string `json:"supplier_ref"`
		Status       string `json:"status"`
		NetRateMinor int64  `json:"net_rate_minor"`
		TaxMinor     int64  `json:"tax_minor"`
		Currency     string `json:"currency"`
		VoucherRef   string `json:"voucher_ref"`
	} `json:"data"`
}

func (r reservationResponse) toReservation() gateway.Reservation {
	return gateway.Reservation{
		SupplierRef: r.Data.SupplierRef,
		Status:      gateway.ReservationStatus(r.Data.Status),
		NetRateKobo: r.Data.NetRateMinor,
		TaxKobo:     r.Data.TaxMinor,
		Currency:    r.Data.Currency,
		VoucherRef:  r.Data.VoucherRef,
	}
}

type cancelResponse struct {
	bbEnvelope
	Data struct {
		Status          string `json:"status"`
		RefundMinor     int64  `json:"refund_minor"`
		PenaltyMinor    int64  `json:"penalty_minor"`
		Currency        string `json:"currency"`
		CancellationRef string `json:"cancellation_ref"`
	} `json:"data"`
}

// --- HTTP helpers (mirror paystack/mycover adapters) ---

func (a *BedbankAdapter) post(ctx context.Context, path string, body, dst any) error {
	return a.postIdem(ctx, path, "", body, dst)
}

func (a *BedbankAdapter) postIdem(ctx context.Context, path, idemKey string, body, dst any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("bedbank: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	a.sign(req, b)
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	return a.do(req, dst)
}

func (a *BedbankAdapter) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.baseURL+path, nil)
	if err != nil {
		return err
	}
	a.sign(req, nil)
	return a.do(req, dst)
}

// sign sets the API key and an HMAC-SHA256 signature header over the request body.
// Secrets are never logged. TODO(live): confirm the supplier's exact signing
// scheme (canonical string, header names) for the chosen Rail-A supplier.
func (a *BedbankAdapter) sign(req *http.Request, body []byte) {
	req.Header.Set("X-Api-Key", a.apiKey)
	if a.apiSecret != "" {
		mac := hmac.New(sha256.New, []byte(a.apiSecret))
		mac.Write(body)
		req.Header.Set("X-Signature", hex.EncodeToString(mac.Sum(nil)))
	}
}

func (a *BedbankAdapter) do(req *http.Request, dst any) error {
	resp, err := a.httpClient.Do(req)
	if err != nil {
		// A supplier timeout/transport error is SUPPLIER_TIMEOUT (PRD §28 A); the
		// Router drops this rail and still returns the other rail's results.
		return fmt.Errorf("bedbank: http request: %w", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("bedbank: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		// Do NOT log body — may contain supplier-side detail. Surface status only.
		return fmt.Errorf("bedbank: server error %d", resp.StatusCode)
	}
	if dst == nil {
		return nil
	}
	return json.Unmarshal(b, dst)
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
