package config

import (
	"strings"
	"testing"
)

const lkSecret = "s3cr3t-s3cr3t-s3cr3t-s3cr3t-s3cr3t-0123"

func TestLoad_LiveKitDefaultsAreOff(t *testing.T) {
	for _, k := range []string{"FEATURE_LIVEKIT_ENABLED", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_TOKEN_TTL_SECONDS"} {
		t.Setenv(k, "")
	}
	c := Load()
	if c.FeatureLiveKitEnabled || c.LiveKitURL != "" || c.LiveKitAPIKey != "" || c.LiveKitAPISecret != "" {
		t.Fatalf("LiveKit must default to off and empty: %+v", c.FeatureLiveKitEnabled)
	}
	if c.LiveKitTokenTTLSeconds != 600 {
		t.Fatalf("default token TTL = %d, want 600", c.LiveKitTokenTTLSeconds)
	}
	t.Setenv("FEATURE_LIVEKIT_ENABLED", "true")
	t.Setenv("LIVEKIT_URL", "wss://rtc.example.com")
	t.Setenv("LIVEKIT_API_KEY", "APIkey")
	t.Setenv("LIVEKIT_API_SECRET", lkSecret)
	t.Setenv("LIVEKIT_TOKEN_TTL_SECONDS", "300")
	c = Load()
	if !c.FeatureLiveKitEnabled || c.LiveKitURL != "wss://rtc.example.com" || c.LiveKitAPIKey != "APIkey" || c.LiveKitAPISecret != lkSecret || c.LiveKitTokenTTLSeconds != 300 {
		t.Fatalf("env not read")
	}
}

func TestValidate_LiveKitNeedsItsCredentialsOutsideDev(t *testing.T) {
	good := func() Config {
		c := staging()
		c.FeatureLiveKitEnabled = true
		c.LiveKitURL, c.LiveKitAPIKey, c.LiveKitAPISecret, c.LiveKitTokenTTLSeconds = "wss://rtc.example.com", "APIkey", lkSecret, 600
		return c
	}
	if err := good().Validate(); err != nil {
		t.Fatalf("a fully configured staging must pass: %v", err)
	}
	for name, mutate := range map[string]func(*Config){
		"no url":              func(c *Config) { c.LiveKitURL = "" },
		"no key":              func(c *Config) { c.LiveKitAPIKey = "" },
		"no secret":           func(c *Config) { c.LiveKitAPISecret = "" },
		"placeholder secret":  func(c *Config) { c.LiveKitAPISecret = "CHANGE_ME" },
		"short secret":        func(c *Config) { c.LiveKitAPISecret = "too-short" },
		"plaintext ws url":    func(c *Config) { c.LiveKitURL = "ws://rtc.example.com" },
		"plaintext http url":  func(c *Config) { c.LiveKitURL = "http://rtc.example.com" },
		"ttl zero":            func(c *Config) { c.LiveKitTokenTTLSeconds = 0 },
		"ttl negative":        func(c *Config) { c.LiveKitTokenTTLSeconds = -1 },
		"ttl above six hours": func(c *Config) { c.LiveKitTokenTTLSeconds = 6*3600 + 1 },
	} {
		c := good()
		mutate(&c)
		err := c.Validate()
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if !strings.Contains(err.Error(), "LIVEKIT") {
			t.Errorf("%s: error does not name the setting: %v", name, err)
		}
		if strings.Contains(err.Error(), lkSecret) {
			t.Errorf("%s: error leaks the secret", name)
		}
	}
	// Flag off: none of it is required.
	off := staging()
	off.LiveKitURL, off.LiveKitAPISecret = "", ""
	if err := off.Validate(); err != nil && strings.Contains(err.Error(), "LIVEKIT") {
		t.Fatalf("LiveKit settings must not be required while the flag is off: %v", err)
	}
}

// Local development may use a plain ws:// server (livekit-server --dev).
func TestValidate_LiveKitAllowsPlaintextInDev(t *testing.T) {
	c := base(true)
	c.AppEnv = "development"
	c.FeatureLiveKitEnabled = true
	c.LiveKitURL, c.LiveKitAPIKey, c.LiveKitAPISecret, c.LiveKitTokenTTLSeconds = "ws://localhost:7880", "devkey", lkSecret, 600
	if err := c.Validate(); err != nil && strings.Contains(err.Error(), "LIVEKIT") {
		t.Fatalf("dev may use ws://localhost: %v", err)
	}
}
