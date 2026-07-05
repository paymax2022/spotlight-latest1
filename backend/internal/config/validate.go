package config

import (
	"encoding/base64"
	"fmt"
	"log"
	"strings"
)

// Fail-fast secret validation. Best practice: a service must not boot in
// production with missing or placeholder secrets, and must never run with a
// swapped key (e.g. a secret key in a public slot). In non-production
// environments the same checks emit warnings so local/dev keeps working with
// placeholders.
//
// Wire this in main(): `if err := cfg.Validate(); err != nil { log.Fatal(err) }`.

// IsProd reports whether this is a production deployment.
func (c Config) IsProd() bool {
	e := strings.ToLower(strings.TrimSpace(c.AppEnv))
	return e == "production" || e == "prod"
}

// isPlaceholder treats empty values and the common template markers as "unset"
// so a copied-but-unfilled .env fails validation instead of silently running.
func isPlaceholder(v string) bool {
	s := strings.TrimSpace(strings.ToLower(v))
	if s == "" {
		return true
	}
	for _, marker := range []string{"xxxx", "change_me", "changeme", "your_", "your-", "redacted", "placeholder", "todo"} {
		if strings.Contains(s, marker) {
			return true
		}
	}
	return false
}

// Validate checks that required secrets are present (and shaped correctly) for
// the features that are enabled. Returns a combined error in production; returns
// nil (after logging warnings) elsewhere.
func (c Config) Validate() error {
	var problems []string

	// require: the value must be a real, non-placeholder secret.
	require := func(cond bool, name, value string) {
		if cond && isPlaceholder(value) {
			problems = append(problems, fmt.Sprintf("%s is required but missing/placeholder", name))
		}
	}
	// prefix: guard against swapped keys (e.g. a public key in the secret slot).
	prefix := func(value, want, name string) {
		if !isPlaceholder(value) && !strings.HasPrefix(value, want) {
			problems = append(problems, fmt.Sprintf("%s does not start with %q — looks like the wrong/swapped key", name, want))
		}
	}

	// Core infrastructure — always required to serve real traffic.
	require(true, "DATABASE_URL", c.DatabaseURL)
	require(true, "SUPABASE_SERVICE_ROLE_KEY", c.SupabaseServiceRoleKey)

	// Payment providers — required only when their money path is enabled.
	paymentsOn := c.FeatureWalletEnabled || c.FeatureBankTransfersEnabled
	require(paymentsOn, "PAYSTACK_SECRET_KEY", c.PaystackSecretKey)
	prefix(c.PaystackSecretKey, "sk_", "PAYSTACK_SECRET_KEY")

	require(c.FeatureBankTransfersEnabled, "MONNIFY_SECRET_KEY", c.MonnifySecretKey)

	require(c.FeatureMapleradEnabled, "MAPLERAD_SECRET_KEY", c.MapleradSecretKey)
	prefix(c.MapleradSecretKey, "mpr_", "MAPLERAD_SECRET_KEY")
	// In production Maplerad must use a live (non-sandbox) key.
	if c.IsProd() && c.FeatureMapleradEnabled && c.MapleradProd && strings.Contains(c.MapleradSecretKey, "sandbox") {
		problems = append(problems, "MAPLERAD_SECRET_KEY is a sandbox key but MAPLERAD_PROD=true")
	}

	// Multi-provider KYC verification (ADR-013): when enabled, at least one
	// provider must be configured and the PII encryption key is mandatory
	// (photos + government bio-data are stored encrypted at rest).
	if c.FeatureKYCVerifyEnabled {
		anyProvider := !isPlaceholder(c.DojahSecretKey) ||
			(!isPlaceholder(c.SmileIDPartnerID) && !isPlaceholder(c.SmileIDAPIKey)) ||
			!isPlaceholder(c.YouverifyToken)
		if !anyProvider {
			problems = append(problems, "FEATURE_KYC_VERIFY_ENABLED=true but no KYC provider is configured (need Dojah, Smile ID, or Youverify)")
		}
		require(true, "KYC_PII_ENC_KEY", c.KYCPIIEncKey)
		// The PII key must be a base64-encoded 32-byte (AES-256) key.
		if !isPlaceholder(c.KYCPIIEncKey) {
			if raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(c.KYCPIIEncKey)); err != nil || len(raw) != 32 {
				problems = append(problems, "KYC_PII_ENC_KEY must be base64 of exactly 32 bytes (AES-256)")
			}
		}
	}

	// Arena (ADR-014): merit entries must be signable — require at least one valid
	// Ed25519 signing seed (base64 32 bytes) when enabled. Any provided seed must
	// be well-formed.
	if c.FeatureArenaEnabled {
		seeds := map[string]string{
			"ARENA_SIGNING_SEED_THEORY":    c.ArenaSigningSeedTheory,
			"ARENA_SIGNING_SEED_PRACTICAL": c.ArenaSigningSeedPractical,
			"ARENA_SIGNING_SEED_FIRSTAID":  c.ArenaSigningSeedFirstAid,
		}
		anySeed := false
		for name, v := range seeds {
			if isPlaceholder(v) {
				continue
			}
			anySeed = true
			if raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(v)); err != nil || len(raw) != 32 {
				problems = append(problems, name+" must be base64 of exactly 32 bytes (Ed25519 seed)")
			}
		}
		if !anySeed {
			problems = append(problems, "FEATURE_ARENA_ENABLED=true but no ARENA_SIGNING_SEED_* is set — merit entries cannot be signed")
		}
		// Dedicated crown-award key (NDC-1 defense-in-depth). Optional — falls back to
		// the practical signer — but must be well-formed when provided.
		if !isPlaceholder(c.ArenaAwardSigningSeed) {
			if raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(c.ArenaAwardSigningSeed)); err != nil || len(raw) != 32 {
				problems = append(problems, "ARENA_AWARD_SIGNING_SEED must be base64 of exactly 32 bytes (Ed25519 seed)")
			}
		}
	}

	// Maps: required when the MapService is enabled. Address lookup degrades to a
	// mock/offline fallback if this is missing, so it is advisory (warn) — but in
	// production a missing Google key means no real geocoding.
	if c.FeatureMapsEnabled && isPlaceholder(c.MapsGoogleKey) {
		problems = append(problems, "MAPS_GOOGLE_KEY is missing while FEATURE_MAPS_ENABLED=true — address lookup will fall back to mock/offline")
	}

	if len(problems) == 0 {
		return nil
	}

	if c.IsProd() {
		return fmt.Errorf("config validation failed (%d problem(s)):\n  - %s",
			len(problems), strings.Join(problems, "\n  - "))
	}
	// Non-production: advisory only, never block local/dev boot.
	log.Printf("[config] %d configuration warning(s) (non-fatal in %s):", len(problems), c.AppEnv)
	for _, p := range problems {
		log.Printf("[config]   - %s", p)
	}
	return nil
}
