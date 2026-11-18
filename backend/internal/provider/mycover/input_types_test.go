package mycover

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/insurance/gateway"
)

// The client sends every dropdown answer as the option's string value, because
// that is what the select contract carries. MyCover's own schema still types
// those answers: payment_plan is a number and bought_for_self a boolean, and its
// compute-price validator rejects "/payment_plan must be number" otherwise.
func TestGetQuote_CoercesProviderTypedAnswers(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		var in struct {
			Body map[string]any `json:"body"`
		}
		_ = dec.Decode(&in)
		body = in.Body
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"price":4000}}`))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	_, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{
			Code:              "outpatient-hospicash-mini",
			ProviderProductID: "uuid",
			FormSchemaKnown:   true,
			NumberInputPaths:  []string{"payment_plan"},
			BooleanInputPaths: []string{"bought_for_self"},
		},
		Inputs: map[string]any{
			"payment_plan":    "12",
			"bought_for_self": "true",
			"hmo_id":          "123456",
		},
	})
	if err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	if n, ok := body["payment_plan"].(json.Number); !ok || n.String() != "12" {
		t.Fatalf("payment_plan must reach the provider as a number: %#v", body["payment_plan"])
	}
	if b, ok := body["bought_for_self"].(bool); !ok || !b {
		t.Fatalf("bought_for_self must reach the provider as a boolean: %#v", body["bought_for_self"])
	}
	if body["hmo_id"] != "123456" {
		t.Fatalf("untyped answers must travel verbatim: %#v", body["hmo_id"])
	}
}

func TestGetQuote_RefusesUnparseableTypedAnswer(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	_, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{
			Code:              "outpatient-hospicash-mini",
			ProviderProductID: "uuid",
			FormSchemaKnown:   true,
			NumberInputPaths:  []string{"payment_plan"},
		},
		Inputs: map[string]any{"payment_plan": "twelve"},
	})
	if err == nil || !strings.Contains(err.Error(), "payment_plan") {
		t.Fatalf("an unparseable number must fail closed and name the field, got %v", err)
	}
}
