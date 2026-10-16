package navigation

import (
	"reflect"
	"testing"
	"time"
)

var funnelT0 = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

func fev(u, route string, min int) StepEvent {
	return StepEvent{UserID: u, Route: route, OccurredAt: funnelT0.Add(time.Duration(min) * time.Minute)}
}

func TestComputeFunnel(t *testing.T) {
	steps := []string{"/a", "/b", "/c"}
	gap := 30 * time.Minute
	cases := []struct {
		name   string
		events []StepEvent
		want   []int64
	}{
		{"full in-order completion", []StepEvent{fev("u1", "/a", 0), fev("u1", "/b", 5), fev("u1", "/c", 10)}, []int64{1, 1, 1}},
		{"gap break stops depth", []StepEvent{fev("u1", "/a", 0), fev("u1", "/b", 31)}, []int64{1, 0, 0}},
		{"gap exactly equal advances", []StepEvent{fev("u1", "/a", 0), fev("u1", "/b", 30)}, []int64{1, 1, 0}},
		{"later occurrence also out of gap stays blocked", []StepEvent{fev("u1", "/a", 0), fev("u1", "/b", 31), fev("u1", "/b", 40)}, []int64{1, 0, 0}},
		{"out-of-order step skipped", []StepEvent{fev("u1", "/b", 0), fev("u1", "/c", 1), fev("u1", "/a", 2), fev("u1", "/b", 3)}, []int64{1, 1, 0}},
		{"non-funnel routes skipped", []StepEvent{fev("u1", "/a", 0), fev("u1", "/x", 1), fev("u1", "/b", 2), fev("u1", "/y", 3), fev("u1", "/c", 4)}, []int64{1, 1, 1}},
		{"repeated route no rewind or double count", []StepEvent{fev("u1", "/a", 0), fev("u1", "/a", 1), fev("u1", "/b", 2), fev("u1", "/a", 3)}, []int64{1, 1, 0}},
		{"two users different depths", []StepEvent{
			fev("u1", "/a", 0), fev("u1", "/b", 1), fev("u1", "/c", 2),
			fev("u2", "/a", 0)}, []int64{2, 1, 1}},
		{"user missing step 0 counted nowhere", []StepEvent{fev("u1", "/b", 0), fev("u1", "/c", 1)}, []int64{0, 0, 0}},
		{"empty events", nil, []int64{0, 0, 0}},
		{"first step ungated by gap", []StepEvent{fev("u1", "/a", 0)}, []int64{1, 0, 0}},
		{"gap measured from last match not first", []StepEvent{fev("u1", "/a", 0), fev("u1", "/b", 25), fev("u1", "/c", 50)}, []int64{1, 1, 1}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ComputeFunnel(c.events, steps, gap)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v want %v", got, c.want)
			}
		})
	}
}
