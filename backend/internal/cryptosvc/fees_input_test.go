package cryptosvc

import (
	"errors"
	"strings"
	"testing"
)

func okInput() FeeScheduleInput {
	return FeeScheduleInput{MajorBps: 80, OtherBps: 110, Majors: []string{"btc", " eth ", "USDT", "USDC", "btc"},
		Overrides: map[string]int{"doge": 140}, Reason: "Q4 pricing review", Actor: "admin-1", IdempotencyKey: "k1"}
}

func TestFeeScheduleInputBuildsANormalisedValidSchedule(t *testing.T) {
	s, err := okInput().Schedule()
	if err != nil {
		t.Fatal(err)
	}
	if s.MajorBps != 80 || s.OtherBps != 110 || s.MaxBps != HardMaxBps {
		t.Fatalf("rates/ceiling wrong: %+v", s)
	}
	for _, a := range []string{"BTC", "ETH", "USDT", "USDC"} {
		if _, ok := s.Majors[a]; !ok {
			t.Errorf("major %s missing after upper-casing/trimming: %v", a, s.Majors)
		}
	}
	if len(s.Majors) != 4 {
		t.Errorf("duplicate majors must collapse: %v", s.Majors)
	}
	if s.Overrides["DOGE"] != 140 {
		t.Errorf("override key must be upper-cased: %v", s.Overrides)
	}
	if bps, _ := s.Bps("doge"); bps != 140 {
		t.Errorf("Bps(doge) = %d", bps)
	}
}

func TestFeeScheduleInputRejectsUnsafeValues(t *testing.T) {
	over := func(n int) map[string]int {
		m := map[string]int{}
		for i := 0; i < n; i++ {
			m[string(rune('A'+i%26))+string(rune('A'+i/26))+"X"] = 100
		}
		return m
	}
	for name, mutate := range map[string]func(*FeeScheduleInput){
		"major above the hard ceiling": func(i *FeeScheduleInput) { i.MajorBps = HardMaxBps + 1 },
		"other above the hard ceiling": func(i *FeeScheduleInput) { i.OtherBps = HardMaxBps + 1 },
		"negative major":               func(i *FeeScheduleInput) { i.MajorBps = -1 },
		"negative other":               func(i *FeeScheduleInput) { i.OtherBps = -5 },
		"override above the ceiling":   func(i *FeeScheduleInput) { i.Overrides = map[string]int{"DOGE": HardMaxBps + 1} },
		"negative override":            func(i *FeeScheduleInput) { i.Overrides = map[string]int{"DOGE": -1} },
		"blank reason":                 func(i *FeeScheduleInput) { i.Reason = "   " },
		"missing actor":                func(i *FeeScheduleInput) { i.Actor = "" },
		"reason too long":              func(i *FeeScheduleInput) { i.Reason = strings.Repeat("x", maxFeeReasonLen+1) },
		"bad asset code (symbol)":      func(i *FeeScheduleInput) { i.Majors = []string{"BTC$"} },
		"bad asset code (empty)":       func(i *FeeScheduleInput) { i.Majors = []string{""} },
		"bad override asset":           func(i *FeeScheduleInput) { i.Overrides = map[string]int{"d o g e": 100} },
		"too many majors": func(i *FeeScheduleInput) {
			i.Majors = make([]string, maxFeeAssets+1)
			for k := range i.Majors {
				i.Majors[k] = "AB" + string(rune('A'+k%26)) + string(rune('A'+k/26))
			}
		},
		"too many overrides":        func(i *FeeScheduleInput) { i.Overrides = over(maxFeeAssets + 1) },
		"negative expected version": func(i *FeeScheduleInput) { i.ExpectedVersion = -1 },
	} {
		in := okInput()
		mutate(&in)
		_, err := in.Schedule()
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if !errors.Is(err, ErrFeeInput) && !errors.Is(err, ErrFeeBps) {
			t.Errorf("%s: err %v is not a typed input error", name, err)
		}
	}
}

func TestFeeScheduleInputAcceptsTheBoundaries(t *testing.T) {
	in := okInput()
	in.MajorBps, in.OtherBps, in.Overrides = 0, HardMaxBps, map[string]int{"DOGE": 0, "SHIB": HardMaxBps}
	if _, err := in.Schedule(); err != nil {
		t.Fatalf("0 and %d bps are both legal: %v", HardMaxBps, err)
	}
}
