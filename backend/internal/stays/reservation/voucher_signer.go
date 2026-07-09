package reservation

import (
	"errors"
	"os"
	"strings"
	"time"

	"spotlight/backend/internal/platform/r2"
)

// voucher_signer.go — reusable R2 presigner for stays booking vouchers.
//
// The reservation handler holds a `signRef func(ref string) (string, error)` that
// turns a stored voucher object ref into a short-lived, presigned GET URL the guest
// can download. When wired to nil the handler returns the raw stored ref (see
// NewHandler); this file provides a real, fail-closed signer.
//
// It REUSES the shared std-lib SigV4 presigner (internal/platform/r2), the same
// client the estate/marketplace/transport/doctor/KYC modules use — no hand-rolled
// signing, no aws-sdk dependency. R2 credentials are SERVER-SIDE ONLY and never
// reach a client; the client only ever sees the minted URL.
//
// Fail-closed: when R2 env is absent the signer returns a clear
// "voucher storage not configured" error rather than a broken/unsigned URL, so
// local/dev still builds and runs (the voucher route then surfaces the error
// instead of leaking a raw ref that would 403 at R2).

// voucherPresignTTL bounds how long an issued voucher download URL is valid.
const voucherPresignTTL = 15 * time.Minute

// ErrVoucherStorageNotConfigured is returned by the signer when R2 creds are
// incomplete (fail-closed; never a fabricated URL).
var ErrVoucherStorageNotConfigured = errors.New("reservation: voucher storage not configured")

// NewR2VoucherSigner builds the voucher presigner from the R2 env vars
// (R2_ACCOUNT_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_REGION), reusing the shared platform/r2 SigV4 presigner. It returns a
// `func(ref string) (string, error)` matching what reservation.NewHandler expects.
//
// It NEVER returns a nil signer + nil error: when R2 is unconfigured it returns a
// working func that yields ErrVoucherStorageNotConfigured (so the caller can wire
// it unconditionally and the route fails closed rather than presenting a raw ref).
// The returned error is reserved for future hard-validation; today it is always nil
// so wiring code can ignore it and stay nil-safe.
func NewR2VoucherSigner() (func(ref string) (string, error), error) {
	presigner := r2.New(r2.Config{
		AccountEndpoint: os.Getenv("R2_ACCOUNT_ENDPOINT"),
		Bucket:          os.Getenv("R2_BUCKET"),
		AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		Region:          os.Getenv("R2_REGION"),
	})
	return newVoucherSignerFromPresigner(presigner), nil
}

// NewR2VoucherSignerFromConfig is the config-injected variant used by the
// orchestrator, which already loads the R2 settings onto its Config struct (it
// does not re-read os.Getenv per module). Both variants produce the identical
// fail-closed signer.
func NewR2VoucherSignerFromConfig(accountEndpoint, bucket, accessKeyID, secretAccessKey, region string) func(ref string) (string, error) {
	return newVoucherSignerFromPresigner(r2.New(r2.Config{
		AccountEndpoint: accountEndpoint,
		Bucket:          bucket,
		AccessKeyID:     accessKeyID,
		SecretAccessKey: secretAccessKey,
		Region:          region,
	}))
}

// newVoucherSignerFromPresigner wraps a platform/r2 Presigner into the
// reservation signRef shape. It treats the stored ref as the R2 object key.
//
//   - If R2 is unconfigured → ErrVoucherStorageNotConfigured (fail-closed).
//   - If the stored ref is already an absolute URL (http/https) → returned
//     unchanged; some legacy/mock vouchers persist a full URL rather than a bare
//     object key, and re-signing an absolute URL would corrupt it.
//   - Otherwise → a presigned GET URL valid for voucherPresignTTL.
func newVoucherSignerFromPresigner(p *r2.Presigner) func(ref string) (string, error) {
	return func(ref string) (string, error) {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			return "", ErrVoucherStorageNotConfigured
		}
		// Legacy/mock full-URL vouchers are passed through unchanged.
		if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
			return ref, nil
		}
		if !p.Configured() {
			return "", ErrVoucherStorageNotConfigured
		}
		// The stored ref is the object key (server-controlled at book time).
		key := strings.TrimPrefix(ref, "/")
		url, err := p.PresignGet(key, voucherPresignTTL)
		if err != nil {
			// Never leak a broken/unsigned URL — surface the failure.
			return "", ErrVoucherStorageNotConfigured
		}
		return url, nil
	}
}
