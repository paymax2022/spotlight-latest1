package mycover

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

// ════════════════════════════════════════════════════════════════════════════
// OUTBOUND MONEY BOUNDARY — kobo (Paymax) → naira (provider)
// ════════════════════════════════════════════════════════════════════════════
//
// The inbound crossing (naira → kobo) was always here. The OUTBOUND crossing was
// not: both sides of the seam assumed the other did it, so every declared value
// reached MyCover 100x too large. Proven live on the 5%-rated gadget product
// ffb0711c-1e4a-453b-a26c-2726e0a1a7bb:
//
//	body.value = 200000    (naira, correct)   → premium NGN 10,000
//	body.value = 20000000  (kobo, the bug)    → premium NGN 1,000,000
//
// A member insuring a ₦200,000 phone was quoted ₦1,000,000.

func TestKoboToNaira_Table(t *testing.T) {
	cases := []struct {
		name string
		kobo int64
		want string
	}{
		{"the live gadget case: ₦200,000", 20_000_000, "200000"},
		{"zero", 0, "0"},
		{"one naira", 100, "1"},
		{"one kobo", 1, "0.01"},
		{"ten kobo keeps one decimal", 10, "0.1"},
		{"a whole minimum: ₦100,000", 10_000_000, "100000"},
		{"half a naira", 50, "0.5"},
		{"mixed", 123_456, "1234.56"},
		{"trailing zero trimmed", 1_250, "12.5"},
		{"large cover: ₦100,000,000", 10_000_000_000, "100000000"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := KoboToNaira(tc.kobo)
			if got.String() != tc.want {
				t.Fatalf("KoboToNaira(%d) = %s, want %s", tc.kobo, got, tc.want)
			}
			// It must marshal as a BARE JSON number, not a quoted string — the
			// provider's `value` is numeric and a string would be rejected.
			b, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(b) != tc.want {
				t.Fatalf("marshalled as %s, want the bare number %s", b, tc.want)
			}
		})
	}
}

// TestKoboToNaira_RoundTripsWithNairaToKobo — the two crossings are inverses on
// every whole-kobo amount. This is the property the whole design rests on: a
// field the schema MISCLASSIFIED as money is multiplied by 100 by the client and
// divided by 100 here, and lands back on the value the member typed.
func TestKoboToNaira_RoundTripsWithNairaToKobo(t *testing.T) {
	for _, kobo := range []int64{0, 1, 7, 99, 100, 1_250, 20_000_000, 10_000_000_000} {
		naira := KoboToNaira(kobo)
		back, err := NairaToKobo(naira.String())
		if err != nil {
			t.Fatalf("NairaToKobo(%s): %v", naira, err)
		}
		if back != kobo {
			t.Fatalf("round trip: %d kobo → %s naira → %d kobo", kobo, naira, back)
		}
	}
}

// TestConvertMoneyInputs_ScalesOnlyTheDeclaredMoneyFields — conversion applies to
// EXACTLY the paths the published schema labelled `money`. Anything else travels
// verbatim: scaling a device serial number or a payment plan would be the same
// bug wearing a different hat.
func TestConvertMoneyInputs_ScalesOnlyTheDeclaredMoneyFields(t *testing.T) {
	in := map[string]any{
		"value":         int64(20_000_000), // ₦200,000 in kobo
		"device_make":   "Samsung",
		"payment_plan":  12,
		"serial_number": "20000000",
	}
	out, err := ConvertMoneyInputsToNaira(in, []string{"value"})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if got := fmt.Sprint(out["value"]); got != "200000" {
		t.Fatalf("value = %v, want 200000 naira", out["value"])
	}
	if out["device_make"] != "Samsung" || out["serial_number"] != "20000000" {
		t.Fatalf("non-money fields must travel verbatim: %v", out)
	}
	if fmt.Sprint(out["payment_plan"]) != "12" {
		t.Fatalf("payment_plan = %v, want 12 — an instalment count is not money", out["payment_plan"])
	}
}

// TestConvertMoneyInputs_DoesNotMutateTheCallersMap — quote inputs are persisted
// and REPLAYED verbatim at bind time. Converting in place would store naira in a
// kobo column and the bind would divide an already-divided value by 100 again.
func TestConvertMoneyInputs_DoesNotMutateTheCallersMap(t *testing.T) {
	in := map[string]any{
		"value":         int64(20_000_000),
		"policy_holder": map[string]any{"annual_income": int64(500_000_000)},
		"office_items":  []any{map[string]any{"item_value": int64(1_000_000)}},
	}
	snapshot := fmt.Sprint(in)

	if _, err := ConvertMoneyInputsToNaira(in, []string{
		"value", "policy_holder.annual_income", "office_items.item_value",
	}); err != nil {
		t.Fatalf("convert: %v", err)
	}
	if got := fmt.Sprint(in); got != snapshot {
		t.Fatalf("caller's inputs were mutated:\n before %s\n after  %s", snapshot, got)
	}
}

// TestConvertMoneyInputs_RecursesIntoObjectsAndRows — ~65 products nest a
// policy_holder and 17 carry repeating rows.
func TestConvertMoneyInputs_RecursesIntoObjectsAndRows(t *testing.T) {
	in := map[string]any{
		"policy_holder": map[string]any{
			"annual_income": int64(500_000_000), // ₦5,000,000
			"first_name":    "Ada",
		},
		"office_items": []any{
			map[string]any{"item_value": int64(1_000_000), "description": "Desk"}, // ₦10,000
			map[string]any{"item_value": int64(250_000)},                          // ₦2,500
		},
	}
	out, err := ConvertMoneyInputsToNaira(in, []string{
		"policy_holder.annual_income", "office_items.item_value",
	})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	ph, _ := out["policy_holder"].(map[string]any)
	if fmt.Sprint(ph["annual_income"]) != "5000000" {
		t.Fatalf("nested money = %v, want 5000000", ph["annual_income"])
	}
	if ph["first_name"] != "Ada" {
		t.Fatalf("nested non-money lost: %v", ph)
	}
	rows, _ := out["office_items"].([]any)
	if len(rows) != 2 {
		t.Fatalf("rows = %v", rows)
	}
	r0, _ := rows[0].(map[string]any)
	r1, _ := rows[1].(map[string]any)
	if fmt.Sprint(r0["item_value"]) != "10000" || fmt.Sprint(r1["item_value"]) != "2500" {
		t.Fatalf("row money = %v / %v, want 10000 / 2500", r0["item_value"], r1["item_value"])
	}
	if r0["description"] != "Desk" {
		t.Fatalf("row non-money lost: %v", r0)
	}
}

// TestConvertMoneyInputs_AcceptsEveryWireShapeExactly — a kobo integer reaches
// this adapter as json.Number (fresh request), float64 (a map round-tripped
// through encoding/json), int/int64 (in-process) or a decimal string. All four
// must convert identically and NONE may go through float arithmetic.
func TestConvertMoneyInputs_AcceptsEveryWireShapeExactly(t *testing.T) {
	shapes := map[string]any{
		"json.Number":         json.Number("20000000"),
		"float64":             float64(20_000_000),
		"int":                 20_000_000,
		"int64":               int64(20_000_000),
		"string":              "20000000",
		"decimal with .00":    "20000000.00",
		"json.Number with .0": json.Number("20000000.0"),
	}
	for name, v := range shapes {
		t.Run(name, func(t *testing.T) {
			out, err := ConvertMoneyInputsToNaira(map[string]any{"value": v}, []string{"value"})
			if err != nil {
				t.Fatalf("convert %T: %v", v, err)
			}
			if got := fmt.Sprint(out["value"]); got != "200000" {
				t.Fatalf("%T → %v, want 200000", v, out["value"])
			}
		})
	}
}

// TestConvertMoneyInputs_FailsClosedOnAnUnusableAmount — a money field we cannot
// convert exactly must stop the call. Passing it through is what produced a
// 100x quote in the first place; guessing is worse.
func TestConvertMoneyInputs_FailsClosedOnAnUnusableAmount(t *testing.T) {
	for name, v := range map[string]any{
		"prose":         "two hundred thousand",
		"exponent":      "2e7",
		"boolean":       true,
		"object":        map[string]any{"amount": 1},
		"sub-kobo":      "0.5", // half a kobo cannot be an integer kobo amount
		"nan-ish float": 20_000_000.5,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ConvertMoneyInputsToNaira(map[string]any{"value": v}, []string{"value"}); err == nil {
				t.Fatalf("%v (%T) converted without error — money must fail closed", v, v)
			}
		})
	}
}

// TestConvertMoneyInputs_AbsentFieldIsNotInvented — an optional money field the
// member left blank is simply not in the map, and must not appear as a zero.
func TestConvertMoneyInputs_AbsentFieldIsNotInvented(t *testing.T) {
	out, err := ConvertMoneyInputsToNaira(map[string]any{"first_name": "Ada"}, []string{"value"})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if _, present := out["value"]; present {
		t.Fatalf("absent money field was invented: %v", out)
	}
	if !reflect.DeepEqual(out, map[string]any{"first_name": "Ada"}) {
		t.Fatalf("out = %v", out)
	}
}
