package smileid_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/smileid"
)

func TestName(t *testing.T) {
	if got := smileid.New("p", "k", false, "https://cb").Name(); got != "smileid" {
		t.Fatalf("Name() = %q, want smileid", got)
	}
}

func TestVerifyDocument_SandboxNotConfigured(t *testing.T) {
	res, err := smileid.New("", "", false, "").VerifyDocument(t.Context(), provider.KycVerifyRequest{ClientRef: "job-1"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != provider.KycPending || res.Terminal {
		t.Fatalf("want pending/non-terminal, got %+v", res)
	}
	if res.ProviderRef != "job-1" {
		t.Fatalf("client ref not echoed: %q", res.ProviderRef)
	}
}

func TestVerifyIDFacial_Submit_IsPendingNonTerminal(t *testing.T) {
	// Even when configured, submission is callback-based → PENDING, non-terminal.
	// With a bogus base URL we still expect an error path, so test the sandbox
	// (unconfigured) pending contract which is what the gateway relies on.
	res, _ := smileid.New("", "", false, "https://cb").VerifyIDFacial(t.Context(), provider.KycVerifyRequest{ClientRef: "j2"})
	if res.Terminal {
		t.Fatal("smileid submit must never be terminal")
	}
	if res.Status != provider.KycPending {
		t.Fatalf("status = %q, want PENDING", res.Status)
	}
}

func TestMapCallback_ActionsAndFraudSignal(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantStatus provider.KycCheckStatus
		wantMatch  bool
		wantDup    string
	}{
		{
			name: "passed_with_duplicate_id",
			body: `{
				"SmileJobID":"sj1",
				"PartnerParams":{"job_id":"cref1","user_id":"u1"},
				"ResultCode":"1012",
				"ResultText":"Enroll User",
				"Actions":{"Verify_ID_Number":"Passed","Selfie_To_ID_Card_Compare":"Passed"},
				"ConfidenceValue":"99.0",
				"IDNumberPreviouslyRegistered":"true",
				"UserIDsOfPreviousRegistrants":["u_old_1","u_old_2"]
			}`,
			wantStatus: provider.KycPassed,
			wantMatch:  true,
			wantDup:    "true",
		},
		{
			name: "failed_selfie_compare",
			body: `{
				"SmileJobID":"sj2",
				"PartnerParams":{"job_id":"cref2"},
				"ResultCode":"0001",
				"ResultText":"No match",
				"Actions":{"Selfie_To_ID_Card_Compare":"Failed"},
				"IDNumberPreviouslyRegistered":"false"
			}`,
			wantStatus: provider.KycFailed,
			wantMatch:  false,
			wantDup:    "false",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := smileid.MapCallbackResultForTest([]byte(tc.body))
			if res.Status != tc.wantStatus {
				t.Fatalf("status = %q, want %q", res.Status, tc.wantStatus)
			}
			if res.Match != tc.wantMatch {
				t.Fatalf("match = %v, want %v", res.Match, tc.wantMatch)
			}
			if got := res.ExtractedFields["id_previously_registered"]; got != tc.wantDup {
				t.Fatalf("id_previously_registered = %q, want %q", got, tc.wantDup)
			}
			if !res.Terminal {
				t.Fatal("callback mapping must be terminal")
			}
		})
	}
}

func TestParseKycWebhook_Correlation(t *testing.T) {
	ev, err := smileid.New("p", "k", false, "").ParseKycWebhook([]byte(`{"SmileJobID":"sj9","PartnerParams":{"job_id":"cref9"},"ResultCode":"0810","Actions":{"Verify_ID_Number":"Passed"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if ev.ClientRef != "cref9" || ev.ProviderRef != "sj9" || ev.EventID != "sj9" {
		t.Fatalf("correlation fields wrong: %+v", ev)
	}
	if ev.Provider != "smileid" {
		t.Fatalf("provider = %q", ev.Provider)
	}
}

func TestVerifyKycSignature_ConfirmSignature(t *testing.T) {
	partner, key := "partner1", "apikey1"
	c := smileid.New(partner, key, false, "")
	ts := "2026-07-01T00:00:00Z"
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(ts))
	mac.Write([]byte(partner))
	mac.Write([]byte("sid_request"))
	good := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	payload := []byte(`{"timestamp":"2026-07-01T00:00:00Z","SmileJobID":"x"}`)
	if !c.VerifyKycSignature(payload, good) {
		t.Fatal("valid confirm_signature rejected")
	}
	if c.VerifyKycSignature(payload, "wrong") {
		t.Fatal("invalid confirm_signature accepted")
	}
	// missing timestamp → reject
	if c.VerifyKycSignature([]byte(`{}`), good) {
		t.Fatal("missing timestamp must reject")
	}
}
