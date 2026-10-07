package paystack

// Partial-refund adapter behaviour (ADR-PRTBD-mobility-card-direct, "Partial
// refunds (car hire)"). Canned responses pin OUR request/parse shape, not
// Paystack's contract — see the ADR's unverified list.

import (
	"context"
	"encoding/json"
	"io"
	"testing"

	"net/http"
	"strings"

	"spotlight/backend/internal/provider"
)

func TestRefundPaymentNoted_SendsMerchantNoteAndAmount(t *testing.T) {
	var seen []*http.Request
	c := clientReplying(200, `{"status":true,"data":{"id":77,"transaction":{"reference":"r1"},"status":"pending","amount":3000}}`, &seen)
	res, err := c.RefundPaymentNoted(context.Background(), "r1", 3000, "r1#sett-1")
	if err != nil || res == nil {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if res.AmountKobo != 3000 || res.Status != "pending" || res.ID != "77" {
		t.Errorf("result = %+v", res)
	}
	b, _ := io.ReadAll(seen[0].Body)
	var body map[string]any
	if err := json.Unmarshal(b, &body); err != nil {
		t.Fatal(err)
	}
	if body["transaction"] != "r1" || body["amount"] != float64(3000) || body["merchant_note"] != "r1#sett-1" {
		t.Errorf("body = %s", b)
	}
	if seen[0].Method != http.MethodPost || seen[0].URL.Path != "/refund" {
		t.Errorf("%s %s", seen[0].Method, seen[0].URL.Path)
	}
}

func TestRefundPaymentNoted_RejectsNonPositiveAmount_AndEmptyNoteOmitsField(t *testing.T) {
	c := clientReplying(200, `{}`, nil)
	if _, err := c.RefundPaymentNoted(context.Background(), "r1", 0, "n"); err == nil {
		t.Error("zero amount must be refused (a zero would mean 'full refund' to Paystack)")
	}
	var seen []*http.Request
	c = clientReplying(200, `{"status":true,"data":{"transaction":{"reference":"r1"},"status":"processed","amount":5}}`, &seen)
	if _, err := c.RefundPayment(context.Background(), "r1", 5); err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(seen[0].Body)
	var body map[string]any
	_ = json.Unmarshal(b, &body)
	if _, has := body["merchant_note"]; has {
		t.Errorf("plain RefundPayment must not start sending a note: %s", b)
	}
}

func TestLookupRefunds_ReturnsAllIncludingFailed(t *testing.T) {
	var seen []*http.Request
	c := clientReplying(200, `{"status":true,"data":[
	  {"id":11,"amount":7000,"status":"processed","transaction_reference":"r1","merchant_note":"r1#fare"},
	  {"id":12,"amount":3000,"status":"failed","transaction_reference":"r1","merchant_note":"r1#dep"},
	  {"id":13,"amount":3000,"status":"pending","transaction_reference":"r1"}]}`, &seen)
	all, err := c.LookupRefunds(context.Background(), "r1")
	if err != nil || len(all) != 3 {
		t.Fatalf("all=%+v err=%v", all, err)
	}
	if all[0].ID != "11" || all[0].Note != "r1#fare" || all[0].AmountKobo != 7000 || all[0].Status != "processed" {
		t.Errorf("first = %+v", all[0])
	}
	if all[1].Status != "failed" || all[2].Note != "" || all[2].Status != "pending" {
		t.Errorf("rest = %+v %+v", all[1], all[2])
	}
	if got := seen[0].URL.Query().Get("reference"); got != "r1" {
		t.Errorf("reference param = %q", got)
	}
}

func TestLookupRefunds_ErrorIsNotNone(t *testing.T) {
	if _, err := clientReplying(500, `boom`, nil).LookupRefunds(context.Background(), "r1"); err == nil {
		t.Error("gateway 5xx must be an error")
	}
	if _, err := clientReplying(200, `{"status":false,"message":"no"}`, nil).LookupRefunds(context.Background(), "r1"); err == nil {
		t.Error("status=false must be an error")
	}
	all, err := clientReplying(200, `{"status":true,"data":[]}`, nil).LookupRefunds(context.Background(), "r1")
	if err != nil || len(all) != 0 {
		t.Errorf("empty list: %v %v", all, err)
	}
}

// L2 (third ledger audit): a refund listed for a DIFFERENT transaction must never be
// counted against this one; and a refund list longer than one page must be read whole.
func TestLookupRefunds_ForeignTransactionReference_IsAnError(t *testing.T) {
	c := clientReplying(200, `{"status":true,"data":[
	  {"id":11,"amount":7000,"status":"processed","transaction_reference":"r1"},
	  {"id":12,"amount":3000,"status":"processed","transaction_reference":"someone-else"}]}`, nil)
	if _, err := c.LookupRefunds(context.Background(), "r1"); err == nil {
		t.Fatal("a refund of another transaction was accepted into this transaction's refund list")
	}
}

func TestLookupRefunds_PaginatesUntilTheLastPage(t *testing.T) {
	var pages []string
	c := New("sk_test_x")
	c.httpClient = &http.Client{Transport: rt(func(r *http.Request) (*http.Response, error) {
		pg := r.URL.Query().Get("page")
		pages = append(pages, pg)
		body := `{"status":true,"meta":{"page":1,"pageCount":3},"data":[{"id":1,"amount":100,"status":"processed","transaction_reference":"r1"}]}`
		switch pg {
		case "2":
			body = `{"status":true,"meta":{"page":2,"pageCount":3},"data":[{"id":2,"amount":200,"status":"processed","transaction_reference":"r1"}]}`
		case "3":
			body = `{"status":true,"meta":{"page":3,"pageCount":3},"data":[{"id":3,"amount":300,"status":"failed","transaction_reference":"r1"}]}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}
	all, err := c.LookupRefunds(context.Background(), "r1")
	if err != nil || len(all) != 3 {
		t.Fatalf("all=%+v err=%v", all, err)
	}
	if strings.Join(pages, ",") != "1,2,3" {
		t.Errorf("pages requested %v, want 1,2,3", pages)
	}
	if all[2].ID != "3" || all[2].Status != "failed" {
		t.Errorf("last = %+v", all[2])
	}
}

func TestLookupRefunds_PageBudgetIsBounded(t *testing.T) {
	n := 0
	c := New("sk_test_x")
	c.httpClient = &http.Client{Transport: rt(func(r *http.Request) (*http.Response, error) {
		n++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":true,"meta":{"pageCount":100000},"data":[{"id":1,"amount":1,"status":"processed","transaction_reference":"r1"}]}`)), Header: http.Header{}}, nil
	})}
	if _, err := c.LookupRefunds(context.Background(), "r1"); err == nil {
		t.Fatal("an unbounded page count must be an error, not a silent truncation")
	}
	if n > maxRefundListPages {
		t.Errorf("%d requests", n)
	}
}

var _ = provider.RefundStatusFailed
