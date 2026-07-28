package healthpharmacy

// Tests for the server-side quantity-cap seam (Symptom-Search PRD §5.5).
// Mirrors the ReviewCaseOpener seam tests: the gate must be a strict no-op
// when not wired (flag off), must run per line, must propagate rejections
// (BLOCKING — unlike the best-effort review opener), and its rejection must
// surface as the structured 422 QTY_CAP_EXCEEDED body through the exact
// mapping helper the CreateOrder HTTP handler uses.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type recordingGate struct {
	calls []string // "productID:qty"
	deny  map[string]*QuantityCapError
	err   error
}

func (g *recordingGate) CheckQuantity(_ context.Context, patientID, productID string, qty int) error {
	g.calls = append(g.calls, fmt.Sprintf("%s:%d", productID, qty))
	if g.err != nil {
		return g.err
	}
	if e, ok := g.deny[productID]; ok {
		return e
	}
	return nil
}

func TestCheckQuantityCaps_NilGateIsNoOp(t *testing.T) {
	s := &Service{} // FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED=false ⇒ never wired
	if err := s.checkQuantityCaps(context.Background(), "patient-1",
		[]OrderLineInput{{ProductID: "p1", Quantity: 3}}); err != nil {
		t.Fatalf("nil gate must be a no-op, got %v", err)
	}
}

func TestCheckQuantityCaps_RunsPerLine(t *testing.T) {
	g := &recordingGate{}
	s := &Service{}
	s.SetQuantityGate(g)
	err := s.checkQuantityCaps(context.Background(), "patient-1", []OrderLineInput{
		{ProductID: "p1", Quantity: 2},
		{ProductID: "p2", Quantity: 5},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(g.calls) != 2 || g.calls[0] != "p1:2" || g.calls[1] != "p2:5" {
		t.Fatalf("gate must see every line, got %v", g.calls)
	}
}

// A cap rejection PROPAGATES (blocking, fail-closed) — unlike the best-effort
// review-case opener, a capped order must never reach the escrow hold.
func TestCheckQuantityCaps_RejectionPropagates(t *testing.T) {
	capErr := &QuantityCapError{ProductID: "p2", MaxQty: 4, WindowDays: 30, Requested: 5, Remaining: 1}
	g := &recordingGate{deny: map[string]*QuantityCapError{"p2": capErr}}
	s := &Service{}
	s.SetQuantityGate(g)
	err := s.checkQuantityCaps(context.Background(), "patient-1", []OrderLineInput{
		{ProductID: "p1", Quantity: 1},
		{ProductID: "p2", Quantity: 5},
	})
	var qe *QuantityCapError
	if !errors.As(err, &qe) {
		t.Fatalf("expected *QuantityCapError, got %v", err)
	}
	if qe.Remaining != 1 || qe.MaxQty != 4 {
		t.Fatalf("cap error must carry the allowance, got %+v", qe)
	}
}

// Infra failures also propagate — the money path fails closed, never open.
func TestCheckQuantityCaps_InfraErrorFailsClosed(t *testing.T) {
	g := &recordingGate{err: fmt.Errorf("db down")}
	s := &Service{}
	s.SetQuantityGate(g)
	if err := s.checkQuantityCaps(context.Background(), "patient-1",
		[]OrderLineInput{{ProductID: "p1", Quantity: 1}}); err == nil {
		t.Fatal("gate infra error must propagate (fail-closed)")
	}
}

// ─── HTTP 422 shape (httptest + gin over the CreateOrder error mapping) ──────

// The route body exercises the exact production path from the gate seam to the
// wire: Service.checkQuantityCaps → failCreateOrder — the same pair the
// CreateOrder handler drives (the full handler needs a live pool for the
// pricing/idempotency reads, so the seam is cut at the gate).
func TestHTTP_CreateOrder_QtyCap422Shape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	capErr := &QuantityCapError{ProductID: "3f0a1c9e-0000-4000-8000-000000000001", MaxQty: 4, WindowDays: 30, Requested: 6, Remaining: 1}
	s := &Service{}
	s.SetQuantityGate(&recordingGate{deny: map[string]*QuantityCapError{capErr.ProductID: capErr}})

	r := gin.New()
	r.POST("/orders", func(c *gin.Context) {
		err := s.checkQuantityCaps(c.Request.Context(), "patient-1",
			[]OrderLineInput{{ProductID: capErr.ProductID, Quantity: 6}})
		if err != nil {
			failCreateOrder(c, err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"success": true})
	})

	req := httptest.NewRequest(http.MethodPost, "/orders", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", w.Code)
	}
	var body struct {
		Success    bool   `json:"success"`
		Code       string `json:"code"`
		Error      string `json:"error"`
		ProductID  string `json:"product_id"`
		MaxQty     int    `json:"max_qty"`
		WindowDays int    `json:"window_days"`
		Remaining  int    `json:"remaining"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if body.Success {
		t.Fatal("422 must carry success=false")
	}
	if body.Code != CodeQtyCapExceeded {
		t.Fatalf("code = %q, want %q", body.Code, CodeQtyCapExceeded)
	}
	if body.ProductID != capErr.ProductID || body.MaxQty != 4 || body.WindowDays != 30 || body.Remaining != 1 {
		t.Fatalf("422 body must carry the cap + remaining allowance, got %+v", body)
	}
	if body.Error == "" {
		t.Fatal("human-readable error message required")
	}
}

// Non-cap errors keep the plain envelope (no code field).
func TestHTTP_CreateOrder_GenericErrorKeepsPlainEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/orders", func(c *gin.Context) {
		failCreateOrder(c, fmt.Errorf("pharmacy: product not found in this pharmacy catalog"))
	})
	req := httptest.NewRequest(http.MethodPost, "/orders", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, hasCode := body["code"]; hasCode {
		t.Fatalf("generic 422 must not carry a cap code, got %v", body)
	}
}
