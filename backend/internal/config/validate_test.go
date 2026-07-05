package config

import "testing"

func base(prod bool) Config {
	env := "development"
	if prod {
		env = "production"
	}
	return Config{
		AppEnv:                 env,
		DatabaseURL:            "postgres://u:p@localhost:5432/db",
		SupabaseServiceRoleKey: "real-service-role-key",
	}
}

func TestValidate_DevNeverFatalsOnPlaceholders(t *testing.T) {
	c := Config{AppEnv: "development"} // everything empty/placeholder
	c.FeatureWalletEnabled = true
	c.FeatureMapleradEnabled = true
	if err := c.Validate(); err != nil {
		t.Fatalf("dev must not fail validation, got: %v", err)
	}
}

func TestValidate_ProdMissingCoreFails(t *testing.T) {
	c := Config{AppEnv: "production"} // no DATABASE_URL / service role
	if err := c.Validate(); err == nil {
		t.Fatal("prod with missing core secrets must fail")
	}
}

func TestValidate_ProdPlaceholderPaystackFails(t *testing.T) {
	c := base(true)
	c.FeatureWalletEnabled = true
	c.PaystackSecretKey = "sk_test_xxxxxxxxxxxx" // placeholder
	if err := c.Validate(); err == nil {
		t.Fatal("placeholder Paystack secret must fail in prod")
	}
}

func TestValidate_SwappedPaystackKeyDetected(t *testing.T) {
	c := base(true)
	c.FeatureWalletEnabled = true
	c.PaystackSecretKey = "pk_live_realbutwrongslot123456" // public key in secret slot
	if err := c.Validate(); err == nil {
		t.Fatal("a pk_ value in PAYSTACK_SECRET_KEY must be rejected (swapped key)")
	}
}

func TestValidate_ProdMapleradSandboxWhenLive(t *testing.T) {
	c := base(true)
	c.FeatureMapleradEnabled = true
	c.MapleradProd = true
	c.MapleradSecretKey = "mpr_sandbox_sk_123456789012" // sandbox key with prod on
	if err := c.Validate(); err == nil {
		t.Fatal("sandbox Maplerad key with MAPLERAD_PROD=true must fail")
	}
}

func TestValidate_ProdHappyPath(t *testing.T) {
	c := base(true)
	c.FeatureWalletEnabled = true
	c.FeatureBankTransfersEnabled = true
	c.FeatureMapleradEnabled = true
	c.PaystackSecretKey = "sk_live_abc123def456ghi789"
	c.MonnifySecretKey = "MNFY_live_secret_abc123"
	c.MapleradSecretKey = "mpr_live_sk_abc123def456"
	if err := c.Validate(); err != nil {
		t.Fatalf("fully configured prod must pass, got: %v", err)
	}
}
