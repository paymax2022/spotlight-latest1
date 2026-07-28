package onboarding

import (
	"errors"
	"testing"
)

// These tests cover the pure, DB-free logic of the onboarding package: the form
// submission validation engine (ValidateSubmission and its helpers), the reviewer
// check derivation (buildChecks), and small pure utilities.
//
// NOTE ON SCOPE: The DRAFT->SUBMITTED->UNDER_REVIEW->APPROVED/REJECTED/NEEDS_MORE_INFO
// state machine (including resubmit and escalate) is NOT enforced by any pure Go
// function. Transition legality is enforced in SQL via Repository.TransitionStatus
// (`WHERE status = ANY($fromStatuses)`) and by status comparisons inside Service
// methods that require a *pgxpool.Pool. Repository wraps the pool with no interface
// seam, so those transitions cannot be exercised without a live database. They are
// intentionally not tested here (no fake DB is invented).

// ── helpers ──────────────────────────────────────────────────────────────────

func fptr(v float64) *float64 { return &v }
func iptr(v int) *int         { return &v }

// oneStepSchema wraps a set of fields into a single-step FormSchema.
func oneStepSchema(fields ...Field) *FormSchema {
	return &FormSchema{
		ID:             "fs-1",
		MerchantTypeID: "mt-1",
		Version:        1,
		Status:         "published",
		Steps:          []Step{{Key: "s1", Title: "Step 1", Fields: fields}},
	}
}

// asValidationError extracts a *ValidationError or fails the test.
func asValidationError(t *testing.T, err error) *ValidationError {
	t.Helper()
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T (%v)", err, err)
	}
	return ve
}

// ── ValidateSubmission: schema-level behavior ────────────────────────────────

func TestValidateSubmission_NilSchema(t *testing.T) {
	err := ValidateSubmission(nil, map[string]interface{}{})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("nil schema: want ErrValidation, got %v", err)
	}
}

func TestValidateSubmission_AllValid(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "name", Type: "text", Label: "Name", Required: true},
		Field{Key: "email", Type: "email", Label: "Email", Required: true},
		Field{Key: "age", Type: "number", Label: "Age", Min: fptr(18), Max: fptr(120)},
	)
	data := map[string]interface{}{
		"name":  "Ada",
		"email": "ada@example.com",
		"age":   float64(30),
	}
	if err := ValidateSubmission(schema, data); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestValidateSubmission_RequiredMissing(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "name", Type: "text", Label: "Name", Required: true},
		Field{Key: "bio", Type: "textarea", Label: "Bio", Required: false},
	)
	// name absent entirely; bio blank but optional -> only name errors.
	err := ValidateSubmission(schema, map[string]interface{}{"bio": "   "})
	ve := asValidationError(t, err)
	if ve.Fields["name"] != "required" {
		t.Fatalf("want name=required, got %v", ve.Fields)
	}
	if _, ok := ve.Fields["bio"]; ok {
		t.Fatalf("optional blank bio should not error, got %v", ve.Fields)
	}
}

func TestValidateSubmission_OptionalEmptySkipped(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "email", Type: "email", Label: "Email", Required: false},
	)
	// Optional email present but empty -> skipped, no format check applied.
	if err := ValidateSubmission(schema, map[string]interface{}{"email": ""}); err != nil {
		t.Fatalf("optional empty email should pass, got %v", err)
	}
}

func TestValidateSubmission_MultipleFieldErrors(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "email", Type: "email", Label: "Email", Required: true},
		Field{Key: "phone", Type: "phone", Label: "Phone", Required: true},
	)
	err := ValidateSubmission(schema, map[string]interface{}{
		"email": "not-an-email",
		"phone": "abc",
	})
	ve := asValidationError(t, err)
	if ve.Fields["email"] != "invalid email" {
		t.Errorf("email: got %q", ve.Fields["email"])
	}
	if ve.Fields["phone"] != "invalid phone" {
		t.Errorf("phone: got %q", ve.Fields["phone"])
	}
}

// ── ValidateSubmission: conditional visibility ───────────────────────────────

func TestValidateSubmission_HiddenRequiredFieldSkipped(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "hasBiz", Type: "boolean", Label: "Has business"},
		Field{
			Key: "rcNumber", Type: "text", Label: "RC Number", Required: true,
			VisibleWhen: &VisibleWhen{Field: "hasBiz", Equals: true},
		},
	)
	// hasBiz=false -> rcNumber hidden -> its required rule must not fire.
	if err := ValidateSubmission(schema, map[string]interface{}{"hasBiz": false}); err != nil {
		t.Fatalf("hidden required field should be skipped, got %v", err)
	}
}

func TestValidateSubmission_VisibleRequiredFieldEnforced(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "hasBiz", Type: "boolean", Label: "Has business"},
		Field{
			Key: "rcNumber", Type: "text", Label: "RC Number", Required: true,
			VisibleWhen: &VisibleWhen{Field: "hasBiz", Equals: true},
		},
	)
	// hasBiz=true -> rcNumber visible and required -> missing -> error.
	err := ValidateSubmission(schema, map[string]interface{}{"hasBiz": true})
	ve := asValidationError(t, err)
	if ve.Fields["rcNumber"] != "required" {
		t.Fatalf("want rcNumber=required, got %v", ve.Fields)
	}
}

func TestValidateSubmission_ControllerFieldAbsentHidesField(t *testing.T) {
	schema := oneStepSchema(
		Field{
			Key: "rcNumber", Type: "text", Label: "RC Number", Required: true,
			VisibleWhen: &VisibleWhen{Field: "hasBiz", Equals: true},
		},
	)
	// Controller field absent -> fieldVisible returns false -> skipped.
	if err := ValidateSubmission(schema, map[string]interface{}{}); err != nil {
		t.Fatalf("absent controller should hide field, got %v", err)
	}
}

// ── fieldVisible / looseEqual ────────────────────────────────────────────────

func TestFieldVisible(t *testing.T) {
	cases := []struct {
		name string
		f    Field
		data map[string]interface{}
		want bool
	}{
		{"no condition", Field{Key: "x"}, map[string]interface{}{}, true},
		{
			"controller absent",
			Field{Key: "x", VisibleWhen: &VisibleWhen{Field: "c", Equals: "y"}},
			map[string]interface{}{}, false,
		},
		{
			"equal string",
			Field{Key: "x", VisibleWhen: &VisibleWhen{Field: "c", Equals: "y"}},
			map[string]interface{}{"c": "y"}, true,
		},
		{
			"not equal",
			Field{Key: "x", VisibleWhen: &VisibleWhen{Field: "c", Equals: "y"}},
			map[string]interface{}{"c": "z"}, false,
		},
		{
			"loose bool vs string",
			Field{Key: "x", VisibleWhen: &VisibleWhen{Field: "c", Equals: "true"}},
			map[string]interface{}{"c": true}, true,
		},
		{
			"loose number vs string",
			Field{Key: "x", VisibleWhen: &VisibleWhen{Field: "c", Equals: "5"}},
			map[string]interface{}{"c": float64(5)}, true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := fieldVisible(tc.f, tc.data); got != tc.want {
				t.Fatalf("fieldVisible=%v want %v", got, tc.want)
			}
		})
	}
}

func TestLooseEqual(t *testing.T) {
	if !looseEqual(true, "true") {
		t.Error("true vs \"true\" should be loosely equal")
	}
	if !looseEqual(float64(5), "5") {
		t.Error("5 vs \"5\" should be loosely equal")
	}
	if looseEqual("a", "b") {
		t.Error("a vs b should not be equal")
	}
}

// ── isEmpty ──────────────────────────────────────────────────────────────────

func TestIsEmpty(t *testing.T) {
	cases := []struct {
		name string
		v    interface{}
		want bool
	}{
		{"nil", nil, true},
		{"blank string", "   ", true},
		{"non-blank string", "x", false},
		{"empty slice", []interface{}{}, true},
		{"non-empty slice", []interface{}{"a"}, false},
		{"empty map", map[string]interface{}{}, true},
		{"non-empty map", map[string]interface{}{"a": 1}, false},
		{"number is not empty", float64(0), false},
		{"bool is not empty", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isEmpty(tc.v); got != tc.want {
				t.Fatalf("isEmpty(%#v)=%v want %v", tc.v, got, tc.want)
			}
		})
	}
}

// ── validateField: per-type rules ───────────────────────────────────────────

func TestValidateField(t *testing.T) {
	cases := []struct {
		name    string
		field   Field
		raw     interface{}
		wantMsg string // "" means valid
	}{
		// text / textarea
		{"text ok", Field{Type: "text"}, "hello", ""},
		{"text wrong type", Field{Type: "text"}, 123, "must be text"},
		{"textarea ok", Field{Type: "textarea"}, "hello", ""},

		// email
		{"email ok", Field{Type: "email"}, "a@b.co", ""},
		{"email bad", Field{Type: "email"}, "nope", "invalid email"},
		{"email wrong type", Field{Type: "email"}, 5, "invalid email"},

		// phone
		{"phone ok plain", Field{Type: "phone"}, "08031234567", ""},
		{"phone ok intl", Field{Type: "phone"}, "+234 803 123 4567", ""},
		{"phone bad", Field{Type: "phone"}, "abc", "invalid phone"},

		// number / currency
		{"number ok", Field{Type: "number"}, float64(10), ""},
		{"number not a number", Field{Type: "number"}, "ten", "must be a number"},
		{"number below min", Field{Type: "number", Min: fptr(5)}, float64(4), "must be >= 5"},
		{"number above max", Field{Type: "number", Max: fptr(5)}, float64(6), "must be <= 5"},
		{"number at min", Field{Type: "number", Min: fptr(5)}, float64(5), ""},
		{"currency ok int", Field{Type: "currency"}, 100, ""},

		// boolean
		{"boolean ok", Field{Type: "boolean"}, true, ""},
		{"boolean wrong type", Field{Type: "boolean"}, "true", "must be true or false"},

		// date
		{"date ok", Field{Type: "date"}, "2026-01-01", ""},
		{"date wrong type", Field{Type: "date"}, 20260101, "invalid date"},

		// select
		{"select ok no options", Field{Type: "select"}, "anything", ""},
		{"select wrong type", Field{Type: "select"}, 1, "invalid selection"},
		{
			"select allowed option",
			Field{Type: "select", Options: []FieldOption{{Label: "A", Value: "a"}}},
			"a", "",
		},
		{
			"select disallowed option",
			Field{Type: "select", Options: []FieldOption{{Label: "A", Value: "a"}}},
			"b", "not an allowed option",
		},

		// address
		{"address string ok", Field{Type: "address"}, "12 Main St", ""},
		{"address object ok", Field{Type: "address"}, map[string]interface{}{"line1": "x"}, ""},
		{"address bad type", Field{Type: "address"}, 42, "invalid address"},

		// document
		{"document string ok", Field{Type: "document"}, "https://r2/doc.pdf", ""},
		{"document object ok", Field{Type: "document"}, map[string]interface{}{"url": "x"}, ""},
		{"document bad type", Field{Type: "document"}, 42, "invalid document reference"},

		// unknown type -> no rule -> valid
		{"unknown type passes", Field{Type: "mystery"}, "whatever", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validateField(tc.field, tc.raw); got != tc.wantMsg {
				t.Fatalf("validateField=%q want %q", got, tc.wantMsg)
			}
		})
	}
}

func TestValidateField_Multiselect(t *testing.T) {
	opts := []FieldOption{{Value: "a"}, {Value: "b"}, {Value: "c"}}
	cases := []struct {
		name    string
		field   Field
		raw     interface{}
		wantMsg string
	}{
		{"not a list", Field{Type: "multiselect", Options: opts}, "a", "must be a list"},
		{"ok subset", Field{Type: "multiselect", Options: opts}, []interface{}{"a", "b"}, ""},
		{
			"disallowed option",
			Field{Type: "multiselect", Options: opts},
			[]interface{}{"a", "z"}, "contains a disallowed option",
		},
		{
			"non-string item",
			Field{Type: "multiselect", Options: opts},
			[]interface{}{1}, "contains a disallowed option",
		},
		{
			"over max selections",
			Field{Type: "multiselect", Options: opts, MaxSelections: iptr(1)},
			[]interface{}{"a", "b"}, "select at most 1",
		},
		{
			"at max selections",
			Field{Type: "multiselect", Options: opts, MaxSelections: iptr(2)},
			[]interface{}{"a", "b"}, "",
		},
		{
			"no options means any string allowed",
			Field{Type: "multiselect"},
			[]interface{}{"free", "text"}, "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validateField(tc.field, tc.raw); got != tc.wantMsg {
				t.Fatalf("validateField=%q want %q", got, tc.wantMsg)
			}
		})
	}
}

// ── optionExists / toNumber ──────────────────────────────────────────────────

func TestOptionExists(t *testing.T) {
	opts := []FieldOption{{Value: "a"}, {Value: "b"}}
	if !optionExists(opts, "a") {
		t.Error("expected 'a' to exist")
	}
	if optionExists(opts, "z") {
		t.Error("did not expect 'z'")
	}
	if optionExists(nil, "a") {
		t.Error("nil options should contain nothing")
	}
}

func TestToNumber(t *testing.T) {
	cases := []struct {
		name   string
		v      interface{}
		wantN  float64
		wantOK bool
	}{
		{"float64", float64(3.5), 3.5, true},
		{"float32", float32(2), 2, true},
		{"int", 7, 7, true},
		{"int64", int64(9), 9, true},
		{"string", "5", 0, false},
		{"nil", nil, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			n, ok := toNumber(tc.v)
			if ok != tc.wantOK || (ok && n != tc.wantN) {
				t.Fatalf("toNumber(%#v)=(%v,%v) want (%v,%v)", tc.v, n, ok, tc.wantN, tc.wantOK)
			}
		})
	}
}

// ── buildChecks ──────────────────────────────────────────────────────────────

func TestBuildChecks(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "name", Type: "text", Label: "Name"},
		Field{Key: "idCard", Type: "document", Label: "ID Card"},
		Field{Key: "utility", Type: "document", Label: "Utility Bill"},
	)
	data := map[string]interface{}{
		"name":   "Ada",
		"idCard": "https://r2/id.pdf", // present -> pending
		// utility absent -> failed
	}
	checks := buildChecks(schema, data)
	if len(checks) != 2 {
		t.Fatalf("want 2 document checks, got %d: %+v", len(checks), checks)
	}
	byKey := map[string]Check{}
	for _, c := range checks {
		byKey[c.Key] = c
	}
	if byKey["idCard"].Status != "pending" {
		t.Errorf("idCard: want pending, got %q", byKey["idCard"].Status)
	}
	if byKey["utility"].Status != "failed" {
		t.Errorf("utility: want failed, got %q", byKey["utility"].Status)
	}
	if byKey["idCard"].Label != "ID Card" {
		t.Errorf("idCard label mismatch: %q", byKey["idCard"].Label)
	}
}

func TestBuildChecks_HiddenDocumentExcluded(t *testing.T) {
	schema := oneStepSchema(
		Field{Key: "hasBiz", Type: "boolean", Label: "Has business"},
		Field{
			Key: "cacDoc", Type: "document", Label: "CAC Doc",
			VisibleWhen: &VisibleWhen{Field: "hasBiz", Equals: true},
		},
	)
	// hasBiz=false hides cacDoc -> no checks derived.
	checks := buildChecks(schema, map[string]interface{}{"hasBiz": false})
	if len(checks) != 0 {
		t.Fatalf("hidden document should produce no check, got %+v", checks)
	}
}

func TestBuildChecks_NoDocumentsReturnsEmptyNonNil(t *testing.T) {
	schema := oneStepSchema(Field{Key: "name", Type: "text", Label: "Name"})
	checks := buildChecks(schema, map[string]interface{}{"name": "Ada"})
	if checks == nil {
		t.Fatal("buildChecks should return non-nil empty slice")
	}
	if len(checks) != 0 {
		t.Fatalf("want 0 checks, got %d", len(checks))
	}
}

// ── small utilities ──────────────────────────────────────────────────────────

func TestValidationError_Error(t *testing.T) {
	ve := &ValidationError{Fields: map[string]string{"x": "required"}}
	if ve.Error() != "validation failed" {
		t.Fatalf("unexpected message: %q", ve.Error())
	}
}

func TestIsUniqueViolation(t *testing.T) {
	if !isUniqueViolation(errors.New("ERROR: duplicate key (SQLSTATE 23505)")) {
		t.Error("expected SQLSTATE 23505 to be detected")
	}
	if isUniqueViolation(errors.New("some other error")) {
		t.Error("unrelated error should not match")
	}
	if isUniqueViolation(nil) {
		t.Error("nil error should not match")
	}
}

func TestNullUUID(t *testing.T) {
	if got := nullUUID(""); got != nil {
		t.Errorf("empty string should map to nil, got %v", got)
	}
	if got := nullUUID("abc"); got != "abc" {
		t.Errorf("non-empty should pass through, got %v", got)
	}
}
