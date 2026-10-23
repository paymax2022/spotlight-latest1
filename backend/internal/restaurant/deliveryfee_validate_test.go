package restaurant

import (
	"errors"
	"testing"
)

func TestDeliveryFeeConfigValidate(t *testing.T) {
	if err := DefaultDeliveryFeeConfig().Validate(); err != nil {
		t.Fatalf("defaults must validate: %v", err)
	}
	c := DefaultDeliveryFeeConfig()
	c.BaseFeeKobo = -1
	if err := c.Validate(); !errors.Is(err, ErrInvalidDeliveryConfig) {
		t.Fatalf("negative base fee must be rejected, got %v", err)
	}
}
