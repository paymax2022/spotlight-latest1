package paystack

// Refund adapter behaviour (H4): the refund STATUS is honoured, an
// "already reversed" answer is a typed error (so the caller verifies it), and
// LookupRefund reads what Paystack actually holds. A canned RoundTripper stands
// in for api.paystack.co — these pin our parsing, NOT Paystack's contract (see
// the ADR's "unverified against the live API" note).

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"spotlight/backend/internal/provider"
)

type rt func(*http.Request) (*http.Response, error)

func (f rt) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func clientReplying(code int, body string, seen *[]*http.Request) *Client {
	c := New("sk_test_x")
	c.httpClient = &http.Client{Transport: rt(func(r *http.Request) (*http.Response, error) {
		if seen != nil {
			*seen = append(*seen, r)
		}
		return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}
	return c
}

func TestRefundPayment_FailedStatusIsAnError(t *testing.T) {
	c := clientReplying(200, `{"status":true,"message":"Refund has been queued for processing","data":{"transaction":{"reference":"r1"},"status":"failed","amount":5000}}`, nil)
	res, err := c.RefundPayment(context.Background(), "r1", 5000)
	if !errors.Is(err, provider.ErrRefundFailed) {
		t.Fatalf("a refund Paystack reports as failed must be an error, got res=%+v err=%v", res, err)
	}
}

func TestRefundPayment_PendingProcessingProcessedAreAccepted(t *testing.T) {
	for _, st := range []string{"pending", "processing", "processed"} {
		c := clientReplying(200, `{"status":true,"data":{"transaction":{"reference":"r1"},"status":"`+st+`","amount":5000}}`, nil)
		res, err := c.RefundPayment(context.Background(), "r1", 5000)
		if err != nil || res.Status != st || !provider.RefundAccepted(res.Status) {
			t.Errorf("%s: res=%+v err=%v", st, res, err)
		}
	}
}

func TestRefundPayment_AlreadyReversedIsTyped(t *testing.T) {
	for _, msg := range []string{"Transaction has been fully reversed", "Transaction has already been reversed", "Transaction already fully refunded"} {
		c := clientReplying(400, `{"status":false,"message":"`+msg+`"}`, nil)
		_, err := c.RefundPayment(context.Background(), "r1", 5000)
		if !errors.Is(err, provider.ErrAlreadyReversed) {
			t.Errorf("%q → %v, want ErrAlreadyReversed", msg, err)
		}
	}
	c := clientReplying(400, `{"status":false,"message":"Invalid transaction reference"}`, nil)
	if _, err := c.RefundPayment(context.Background(), "r1", 5000); err == nil || errors.Is(err, provider.ErrAlreadyReversed) {
		t.Errorf("an unrelated 400 must stay a plain error: %v", err)
	}
}

func TestLookupRefund_ParsesAndPrefersAcceptedRefund(t *testing.T) {
	var seen []*http.Request
	c := clientReplying(200, `{"status":true,"data":[
	  {"id":11,"amount":5000,"status":"failed","transaction_reference":"r1"},
	  {"id":12,"amount":5000,"status":"processed","transaction_reference":"r1"}]}`, &seen)
	res, err := c.LookupRefund(context.Background(), "r1")
	if err != nil || res == nil {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if res.Status != "processed" || res.AmountKobo != 5000 || res.Reference != "r1" {
		t.Errorf("lookup = %+v: an accepted refund must win over an earlier failed attempt", res)
	}
	if got := seen[0].URL.Query().Get("reference"); got != "r1" || seen[0].Method != http.MethodGet {
		t.Errorf("request %s %s", seen[0].Method, seen[0].URL.String())
	}
}

func TestLookupRefund_OnlyFailedReturnsFailed_NoneReturnsNil(t *testing.T) {
	c := clientReplying(200, `{"status":true,"data":[{"id":11,"amount":5000,"status":"failed"}]}`, nil)
	if res, err := c.LookupRefund(context.Background(), "r1"); err != nil || res == nil || res.Status != "failed" {
		t.Errorf("only-failed: %+v %v", res, err)
	}
	c = clientReplying(200, `{"status":true,"data":[]}`, nil)
	if res, err := c.LookupRefund(context.Background(), "r1"); err != nil || res != nil {
		t.Errorf("none: %+v %v, want (nil, nil)", res, err)
	}
	c = clientReplying(500, `boom`, nil)
	if _, err := c.LookupRefund(context.Background(), "r1"); err == nil {
		t.Error("a gateway error must be an error, never 'no refund'")
	}
	c = clientReplying(200, `{"status":false,"message":"nope"}`, nil)
	if _, err := c.LookupRefund(context.Background(), "r1"); err == nil {
		t.Error("status=false must be an error, never 'no refund'")
	}
}
