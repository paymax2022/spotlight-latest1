package config

import "testing"

func TestLoad_VertoFeeSweepFlagDefaultsOff(t *testing.T) {
	t.Setenv("FEATURE_VERTO_FEE_SWEEP", "")
	if Load().FeatureVertoFeeSweepEnabled {
		t.Fatal("FEATURE_VERTO_FEE_SWEEP must default to off")
	}
	t.Setenv("FEATURE_VERTO_FEE_SWEEP", "true")
	if !Load().FeatureVertoFeeSweepEnabled {
		t.Fatal("FEATURE_VERTO_FEE_SWEEP=true must enable")
	}
}
