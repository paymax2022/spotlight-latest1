package app

import (
	"context"
	"strings"
	"testing"

	"spotlight/backend/internal/platform/r2"
)

func testPresigner() *r2.Presigner {
	return r2.New(r2.Config{
		AccountEndpoint: "https://acct.r2.cloudflarestorage.com",
		Bucket:          "evidence-test",
		AccessKeyID:     "AKIATEST",
		SecretAccessKey: "secret-test",
		Region:          "auto",
	})
}

func TestR2CredentialSigner_SignsAShortLivedGetURL(t *testing.T) {
	url, err := r2CredentialSigner{p: testPresigner()}.SignGet(context.Background(), "vet/verification/abc.pdf")
	if err != nil {
		t.Fatalf("SignGet: %v", err)
	}
	if !strings.HasPrefix(url, "https://") || !strings.Contains(url, "X-Amz-Signature=") || !strings.Contains(url, "X-Amz-Expires=300") {
		t.Fatalf("not a 5-minute presigned GET URL: %s", url)
	}
}

func TestR2CredentialSigner_RefusesAnEmptyStorageKey(t *testing.T) {
	if _, err := (r2CredentialSigner{p: testPresigner()}).SignGet(context.Background(), ""); err == nil {
		t.Fatal("expected an error for an empty storage key")
	}
}

func TestUnconfiguredPresignerIsNotWiredAsASigner(t *testing.T) {
	// RegisterHealthVCNVerification only installs the signer when R2 is configured,
	// so an unconfigured deployment keeps the old behaviour (empty URL, access logged).
	if (*r2.Presigner)(nil).Configured() || r2.New(r2.Config{}).Configured() {
		t.Fatal("an unconfigured presigner must report Configured() == false")
	}
}
