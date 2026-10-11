package restaurant

import "testing"

func TestItemPrepBounds_FiveToOneEighty(t *testing.T) {
	for _, ok := range []int{5, 12, 180} {
		if err := validItemPrepMinutes(ok); err != nil {
			t.Errorf("%d refused: %v", ok, err)
		}
	}
	for _, bad := range []int{0, 4, 181, -5} {
		if err := validItemPrepMinutes(bad); err == nil {
			t.Errorf("%d accepted", bad)
		}
	}
}

func TestRestaurantPrepDefault_StepsOfFive(t *testing.T) {
	for _, ok := range []int{5, 15, 20, 180} {
		if err := validRestaurantPrepMinutes(ok); err != nil {
			t.Errorf("%d refused: %v", ok, err)
		}
	}
	for _, bad := range []int{7, 22, 4, 185} {
		if err := validRestaurantPrepMinutes(bad); err == nil {
			t.Errorf("%d accepted", bad)
		}
	}
}

// A multi-item order is ready when its slowest item is, so the estimate adds the
// largest prep time, not the sum.
func TestEtaFoldsInTheSlowestItem(t *testing.T) {
	if got := totalEtaMinutes(25, 10); got != 35 {
		t.Fatalf("eta = %v, want 35", got)
	}
	if got := totalEtaMinutes(0, 10); got != 10 {
		t.Fatalf("no prep = %v, want travel only", got)
	}
}
