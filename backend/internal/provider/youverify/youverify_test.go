package youverify_test

import (
	"testing"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/youverify"
)

func TestName(t *testing.T) {
	if got := youverify.New("tok", false).Name(); got != "youverify" {
		t.Fatalf("Name() = %q, want youverify", got)
	}
}

func TestVerifyIDNumber_SandboxNotConfigured(t *testing.T) {
	res, err := youverify.New("", false).VerifyIDNumber(t.Context(), provider.KycVerifyRequest{ClientRef: "r1", IDType: "bvn", IDNumber: "1"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != provider.KycPending || res.Terminal {
		t.Fatalf("want pending/non-terminal, got %+v", res)
	}
	if res.ProviderRef != "r1" {
		t.Fatalf("client ref not echoed: %q", res.ProviderRef)
	}
}

func TestVerifyIDFacial_ThresholdGate(t *testing.T) {
	// mapFacial is exercised indirectly via the exported flow; assert threshold
	// behaviour through the mapper by feeding a sample JSON body.
	cases := []struct {
		name       string
		body       string
		threshold  int
		wantMatch  bool
		wantStatus provider.KycCheckStatus
	}{
		{
			name:       "above_threshold",
			body:       `{"success":true,"data":{"id":"job1","face_details":{"confidence":92.5}}}`,
			threshold:  70,
			wantMatch:  true,
			wantStatus: provider.KycPassed,
		},
		{
			name:       "below_threshold_review",
			body:       `{"success":true,"data":{"id":"job2","face_details":{"confidence":40}}}`,
			threshold:  70,
			wantMatch:  false,
			wantStatus: provider.KycReview,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := youverify.MapFacialForTest([]byte(tc.body), "cref", tc.threshold)
			if res.Match != tc.wantMatch {
				t.Fatalf("Match = %v, want %v", res.Match, tc.wantMatch)
			}
			if res.Status != tc.wantStatus {
				t.Fatalf("Status = %q, want %q", res.Status, tc.wantStatus)
			}
			if !res.Terminal {
				t.Fatalf("facial should be terminal for sync provider")
			}
		})
	}
}

func TestMapIDNumber(t *testing.T) {
	res := youverify.MapIDNumberForTest([]byte(`{"success":true,"data":{"id":"jb","firstName":"ADA","lastName":"LOVELACE"}}`), "cref")
	if !res.Match || res.Status != provider.KycPassed {
		t.Fatalf("want passed match, got %+v", res)
	}
	if res.ExtractedFields["firstName"] != "ADA" {
		t.Fatalf("extracted fields wrong: %+v", res.ExtractedFields)
	}
	if res.ProviderRef != "jb" {
		t.Fatalf("providerRef = %q, want jb", res.ProviderRef)
	}
	// not found
	nf := youverify.MapIDNumberForTest([]byte(`{"success":false,"message":"not found","data":null}`), "cref")
	if nf.Status != provider.KycFailed {
		t.Fatalf("want failed, got %q", nf.Status)
	}
}

func TestMapWebhook(t *testing.T) {
	ev, err := youverify.New("tok", false).ParseKycWebhook([]byte(`{"event":"identity.completed","data":{"id":"job9","reference":"cref9","status":"found","face_details":{"confidence":88}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if ev.Status != provider.KycPassed {
		t.Fatalf("status = %q, want passed", ev.Status)
	}
	if ev.ClientRef != "cref9" || ev.ProviderRef != "job9" {
		t.Fatalf("ref mismatch: %+v", ev)
	}
	if ev.Confidence != 88 {
		t.Fatalf("confidence = %v, want 88", ev.Confidence)
	}
}
