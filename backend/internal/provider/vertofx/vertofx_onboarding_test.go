package vertofx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestClient_CreateSubAccount_SendsIdentityAndType(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v2/sub-accounts" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["name"] != "Ada Ltd" || in["country"] != "NG" || in["identificationNumber"] != "RC123" || in["accountType"] != "business" {
			t.Errorf("body = %v", in)
		}
		_, _ = w.Write([]byte(`{"data":{"companyId":"sub-9","status":"pending"}}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	sa, err := c.CreateSubAccount(context.Background(), SubAccountInput{Name: "Ada Ltd", Country: "NG", IdentificationNumber: "RC123", AccountType: "business"})
	if err != nil {
		t.Fatal(err)
	}
	if sa.CompanyID != "sub-9" || sa.Status != "pending" {
		t.Errorf("sa = %+v", sa)
	}
}

func TestClient_SubmitOnboarding_PostsPayloadToCompany(t *testing.T) {
	var logins int32
	var hit int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hit, 1)
		if r.Method != http.MethodPost || r.URL.Path != "/companies/sub-9/onboarding-data" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["legalName"] != "Ada Ltd" || in["registrationNumber"] != "RC123" {
			t.Errorf("body = %v", in)
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	err := c.SubmitOnboarding(context.Background(), "sub-9", OnboardingData{LegalName: "Ada Ltd", RegistrationNumber: "RC123", Country: "NG"})
	if err != nil {
		t.Fatal(err)
	}
	if hit != 1 {
		t.Errorf("hits = %d", hit)
	}
	if err := c.SubmitOnboarding(context.Background(), "", OnboardingData{}); err == nil {
		t.Error("empty companyID must error")
	}
}

func TestClient_GetSubAccount_ParsesStatus(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v2/sub-accounts/sub-9" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"data":{"companyId":"sub-9","status":"approved"}}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	sa, err := c.GetSubAccount(context.Background(), "sub-9")
	if err != nil {
		t.Fatal(err)
	}
	if sa.CompanyID != "sub-9" || sa.Status != "approved" {
		t.Errorf("sa = %+v", sa)
	}
}

func TestClient_EnsureWallet_Idempotent(t *testing.T) {
	var logins int32
	var creates int32
	wallets := []map[string]string{}
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sub-9/wallets" {
			t.Errorf("path = %s", r.URL.Path)
		}
		switch r.Method {
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"data": wallets})
		case http.MethodPost:
			atomic.AddInt32(&creates, 1)
			var in map[string]string
			_ = json.NewDecoder(r.Body).Decode(&in)
			wl := map[string]string{"walletId": "w-" + in["currency"], "currency": in["currency"], "status": "active"}
			wallets = append(wallets, wl)
			_ = json.NewEncoder(w).Encode(map[string]any{"data": wl})
		}
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	a, err := c.EnsureWallet(context.Background(), "sub-9", "USD")
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.EnsureWallet(context.Background(), "sub-9", "USD")
	if err != nil {
		t.Fatal(err)
	}
	if a.WalletID != "w-USD" || a != b {
		t.Errorf("a=%+v b=%+v", a, b)
	}
	if creates != 1 {
		t.Errorf("creates = %d, want 1", creates)
	}
}

func TestClient_GetFundingDetails_ParsesDedicatedAndPooled(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sub-9/funding-methods" || r.URL.Query().Get("currency") != "USD" {
			t.Errorf("url = %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"data":[
		 {"type":"pooled","accountName":"Verto Pool","accountNumber":"111","bankName":"PB","bankCode":"P1","reference":"REF-77"},
		 {"type":"dedicated","accountName":"Ada Ltd","accountNumber":"222","bankName":"DB","bankCode":"D1","reference":""}]}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	f, err := c.GetFundingDetails(context.Background(), "sub-9", "USD")
	if err != nil {
		t.Fatal(err)
	}
	if f.Mode != "dedicated" || f.AccountNumber != "222" {
		t.Errorf("primary = %+v", f)
	}
	if len(f.Methods) != 2 || f.Methods[0].Mode != "pooled" || f.Methods[0].Reference != "REF-77" {
		t.Errorf("methods = %+v", f.Methods)
	}
}

func TestClient_GenerateUploadLink(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/companies/sub-9/documents/upload-link" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		var in map[string]string
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["documentType"] != "certificate_of_incorporation" || in["fileName"] != "cert.pdf" {
			t.Errorf("body = %v", in)
		}
		_, _ = w.Write([]byte(`{"data":{"uploadUrl":"https://s3.example/put","documentId":"doc-1"}}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	l, err := c.GenerateUploadLink(context.Background(), "sub-9", UploadLinkInput{DocumentType: "certificate_of_incorporation", FileName: "cert.pdf", ContentType: "application/pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if l.URL != "https://s3.example/put" || l.DocumentID != "doc-1" {
		t.Errorf("l = %+v", l)
	}
}

func TestClient_Onboarding_OfflineMockMakesNoHTTP(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { atomic.AddInt32(&hits, 1) }))
	defer srv.Close()
	c := New("", "", false).WithBaseURL(srv.URL)
	ctx := context.Background()
	sa, err := c.CreateSubAccount(ctx, SubAccountInput{Name: "x", IdentificationNumber: "RC1"})
	if err != nil || sa.CompanyID == "" {
		t.Fatalf("sa=%+v err=%v", sa, err)
	}
	sa2, _ := c.CreateSubAccount(ctx, SubAccountInput{Name: "x", IdentificationNumber: "RC1"})
	if sa2 != sa {
		t.Errorf("mock not deterministic: %+v vs %+v", sa, sa2)
	}
	if err := c.SubmitOnboarding(ctx, sa.CompanyID, OnboardingData{}); err != nil {
		t.Error(err)
	}
	if g, err := c.GetSubAccount(ctx, sa.CompanyID); err != nil || g.CompanyID != sa.CompanyID {
		t.Errorf("g=%+v err=%v", g, err)
	}
	w1, err := c.EnsureWallet(ctx, sa.CompanyID, "USD")
	w2, _ := c.EnsureWallet(ctx, sa.CompanyID, "USD")
	if err != nil || w1.WalletID == "" || w1 != w2 {
		t.Errorf("w1=%+v w2=%+v err=%v", w1, w2, err)
	}
	if f, err := c.GetFundingDetails(ctx, sa.CompanyID, "USD"); err != nil || f.AccountNumber == "" {
		t.Errorf("f=%+v err=%v", f, err)
	}
	if l, err := c.GenerateUploadLink(ctx, sa.CompanyID, UploadLinkInput{FileName: "a.pdf"}); err != nil || l.URL == "" {
		t.Errorf("l=%+v err=%v", l, err)
	}
	if hits != 0 {
		t.Errorf("offline mode made %d HTTP calls", hits)
	}
}
