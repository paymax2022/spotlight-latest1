package utilitybills

// Pure-logic tests for the Phase 4 admin surface. Zero I/O, zero database:
// everything here is the branching logic that sits between an HTTP body and a
// SQL statement, which is exactly where a partial-update bug hides.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// ── adminListBounds ──────────────────────────────────────────────────────────

func TestAdminListBounds(t *testing.T) {
	cases := []struct {
		name                  string
		limit, offset         int
		wantLimit, wantOffset int
	}{
		// The ADMIN defaults from _utils.ts's adminPagination — deliberately NOT
		// the member-facing 20/100 that ListUserTransactions uses.
		{"defaults when unset", 0, 0, 50, 0},
		{"negative limit falls back to the default", -5, 0, 50, 0},
		{"capped at 200", 5000, 0, 200, 0},
		{"exactly at the cap", 200, 0, 200, 0},
		{"negative offset floors at zero", 10, -3, 10, 0},
		{"honoured when in range", 25, 75, 25, 75},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			limit, offset := adminListBounds(tc.limit, tc.offset)
			if limit != tc.wantLimit || offset != tc.wantOffset {
				t.Errorf("adminListBounds(%d,%d) = (%d,%d), want (%d,%d)",
					tc.limit, tc.offset, limit, offset, tc.wantLimit, tc.wantOffset)
			}
		})
	}
}

// ── setBuilder ───────────────────────────────────────────────────────────────

func TestSetBuilder_SkipsNilFieldsAndNumbersPlaceholders(t *testing.T) {
	name := "Eko Prepaid"
	priority := 7
	var absent *string // nil ⇒ "leave this column alone"

	b := newSetBuilder()
	b.set("name", name2ptr(name))
	b.set("code", absent)
	b.setOrNull("amount_kobo", nil, true) // explicit clear
	b.set("priority", &priority)

	query := b.query("public.utility_products", "id", "id, name")
	want := "UPDATE public.utility_products SET updated_at = now(), name = $1, amount_kobo = NULL, priority = $2 WHERE id = $3 RETURNING id, name"
	if query != want {
		t.Errorf("query =\n%s\nwant\n%s", query, want)
	}

	// The key must bind to the LAST placeholder — an off-by-one here would
	// update the wrong row, or every row.
	args := b.args("row-id")
	if len(args) != 3 {
		t.Fatalf("args length = %d, want 3", len(args))
	}
	if args[0] != name || args[1] != priority || args[2] != "row-id" {
		t.Errorf("args = %v, want [%q %d row-id]", args, name, priority)
	}
}

// A patch that sets nothing must be detectable, so the caller can short-circuit
// to a plain read instead of issuing a no-op UPDATE that still bumps updated_at.
func TestSetBuilder_EmptyDetectsANoOpPatch(t *testing.T) {
	b := newSetBuilder()
	if !b.empty() {
		t.Error("a fresh builder must report empty")
	}
	b.set("name", (*string)(nil))
	if !b.empty() {
		t.Error("a nil field must not count as a change")
	}
	b.set("name", name2ptr("x"))
	if b.empty() {
		t.Error("a set field must count as a change")
	}
}

// Clear WINS over a value, matching TransactionPatch.ClearFailureReason's
// documented precedence. One rule everywhere means a patch carrying both is
// never ambiguous.
func TestSetBuilder_ClearTakesPrecedenceOverAValue(t *testing.T) {
	v := int64(500)
	b := newSetBuilder()
	b.setOrNull("max_amount_kobo", &v, true)

	if got := b.query("t", "id", "id"); !strings.Contains(got, "max_amount_kobo = NULL") {
		t.Errorf("query = %s, want max_amount_kobo = NULL", got)
	}
	if args := b.args("k"); len(args) != 1 {
		t.Errorf("a cleared column must bind no value; args = %v", args)
	}
}

func name2ptr(s string) *string { return &s }

// ── patchBody: absent vs null vs value ───────────────────────────────────────

func decodePatch(t *testing.T, body string) patchBody {
	t.Helper()
	var p patchBody
	if err := json.Unmarshal([]byte(body), &p); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return p
}

// The three-state distinction is the whole reason patchBody exists: a nil
// pointer from str()/i64() means "absent OR null", and isNull() separates them.
func TestPatchBody_AbsentNullAndValueAreThreeDistinctStates(t *testing.T) {
	p := decodePatch(t, `{"name":"Eko","max_amount_kobo":null}`)

	// Present with a value.
	name, err := p.str("name")
	if err != nil || name == nil || *name != "Eko" {
		t.Fatalf("str(name) = %v, %v; want \"Eko\"", name, err)
	}
	if p.isNull("name") {
		t.Error("a present, non-null key must not report as null")
	}

	// Present and null ⇒ clear.
	max, err := p.i64("max_amount_kobo")
	if err != nil || max != nil {
		t.Fatalf("i64(max_amount_kobo) = %v, %v; want nil", max, err)
	}
	if !p.isNull("max_amount_kobo") {
		t.Error("an explicit null must report as null so the column can be cleared")
	}

	// Absent ⇒ leave alone.
	min, err := p.i64("min_amount_kobo")
	if err != nil || min != nil {
		t.Fatalf("i64(min_amount_kobo) = %v, %v; want nil", min, err)
	}
	if p.isNull("min_amount_kobo") {
		t.Error("an ABSENT key must not report as null — that would clear a column nobody asked to clear")
	}
}

// Kobo amounts must survive binding exactly. A value past 2^53 is the canonical
// proof that the decode path never went through a float64.
func TestPatchBody_LargeKoboSurvivesExactly(t *testing.T) {
	const huge = int64(9007199254740993) // 2^53 + 1, unrepresentable as a float64
	p := decodePatch(t, `{"amount_kobo":9007199254740993}`)

	got, err := p.i64("amount_kobo")
	if err != nil {
		t.Fatalf("i64: %v", err)
	}
	if got == nil || *got != huge {
		t.Fatalf("i64(amount_kobo) = %v, want %d — a float64 round-trip would yield %d",
			got, huge, int64(float64(huge)))
	}
}

func TestPatchBody_RejectsWrongTypesAndFractionalKobo(t *testing.T) {
	cases := []struct {
		name string
		body string
		call func(patchBody) error
	}{
		{"string field given a number", `{"name":42}`, func(p patchBody) error {
			_, err := p.str("name")
			return err
		}},
		{"kobo given a string", `{"amount_kobo":"500"}`, func(p patchBody) error {
			_, err := p.i64("amount_kobo")
			return err
		}},
		{"kobo given a fraction", `{"amount_kobo":10.5}`, func(p patchBody) error {
			_, err := p.i64("amount_kobo")
			return err
		}},
		{"bool given a string", `{"enabled":"yes"}`, func(p patchBody) error {
			_, err := p.boolean("enabled")
			return err
		}},
		{"string array given a scalar", `{"supported_categories":"airtime"}`, func(p patchBody) error {
			_, err := p.strSlice("supported_categories")
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(decodePatch(t, tc.body)); err == nil {
				t.Error("want an error, got nil — a malformed field must be a 400, not a silent no-op")
			}
		})
	}
}

func TestPatchBody_StrSliceAndRawJSON(t *testing.T) {
	p := decodePatch(t, `{"supported_categories":["airtime","data"],"config":{"timeout_ms":9000}}`)

	cats, err := p.strSlice("supported_categories")
	if err != nil || cats == nil || len(*cats) != 2 || (*cats)[1] != "data" {
		t.Fatalf("strSlice = %v, %v", cats, err)
	}
	if raw := p.rawJSON("config"); string(raw) != `{"timeout_ms":9000}` {
		t.Errorf("rawJSON(config) = %s", raw)
	}
	if raw := p.rawJSON("missing"); raw != nil {
		t.Errorf("rawJSON of an absent key = %s, want nil", raw)
	}
}

// ── Value validation ─────────────────────────────────────────────────────────

func TestValidateStatus(t *testing.T) {
	// A blank value means "unset" and is always allowed — the DB default applies.
	if err := validateStatus("", providerStatuses, ErrInvalidStatus); err != nil {
		t.Errorf("blank status must be allowed: %v", err)
	}
	// 'maintenance' is valid for a PROVIDER but not for a catalogue row: the two
	// CHECK constraints genuinely differ, which is why the lists are separate.
	if err := validateStatus("maintenance", providerStatuses, ErrInvalidStatus); err != nil {
		t.Errorf("maintenance must be valid for a provider: %v", err)
	}
	if err := validateStatus("maintenance", catalogueStatuses, ErrInvalidStatus); err == nil {
		t.Error("maintenance must be rejected for a catalogue row — the column's CHECK forbids it")
	}
	if err := validateStatus("enabled", catalogueStatuses, ErrInvalidStatus); err == nil {
		t.Error("an unknown status must be rejected before it reaches the database")
	}
}

func TestValidatePositiveKoboAndNonNegative(t *testing.T) {
	zero, negative, positive := int64(0), int64(-1), int64(100)

	if err := validatePositiveKobo(nil, "x"); err != nil {
		t.Errorf("nil means unbounded, not invalid: %v", err)
	}
	// The columns' CHECK is `IS NULL OR > 0` — zero is NOT a valid bound.
	if err := validatePositiveKobo(&zero, "x"); err == nil {
		t.Error("zero must be rejected: the CHECK constraint requires > 0")
	}
	if err := validatePositiveKobo(&negative, "x"); err == nil {
		t.Error("a negative kobo bound must be rejected")
	}
	if err := validatePositiveKobo(&positive, "x"); err != nil {
		t.Errorf("a positive bound must pass: %v", err)
	}

	// Fees and basis points use `>= 0`, so zero IS valid there.
	if err := validateNonNegative(&zero, "markup_bps"); err != nil {
		t.Errorf("zero markup must be allowed: %v", err)
	}
	if err := validateNonNegative(&negative, "markup_bps"); err == nil {
		t.Error("a negative markup must be rejected — it is a silent loss per sale")
	}
}

func TestValidateProductInput(t *testing.T) {
	valid := func() ProductInput {
		amount := int64(500_000)
		return ProductInput{
			BillerID: "biller-1", Category: "electricity", Name: "Eko Prepaid",
			Code: "eko-prepaid", AmountType: "fixed", AmountKobo: &amount, Status: "active",
		}
	}

	in := valid()
	if err := validateProductInput(&in); err != nil {
		t.Fatalf("a valid product must pass: %v", err)
	}

	t.Run("trims and normalises", func(t *testing.T) {
		in := valid()
		in.Name = "  Eko Prepaid  "
		if err := validateProductInput(&in); err != nil {
			t.Fatalf("validate: %v", err)
		}
		if in.Name != "Eko Prepaid" {
			t.Errorf("name = %q, want it trimmed", in.Name)
		}
	})

	bad := map[string]func(*ProductInput){
		"unknown category":    func(p *ProductInput) { p.Category = "water" },
		"blank category":      func(p *ProductInput) { p.Category = "" },
		"missing biller":      func(p *ProductInput) { p.BillerID = "" },
		"whitespace name":     func(p *ProductInput) { p.Name = "   " },
		"missing code":        func(p *ProductInput) { p.Code = "" },
		"unknown amount type": func(p *ProductInput) { p.AmountType = "sliding" },
		"unknown status":      func(p *ProductInput) { p.Status = "archived" },
		"zero amount":         func(p *ProductInput) { z := int64(0); p.AmountKobo = &z },
		"negative fee":        func(p *ProductInput) { n := int64(-1); p.ConvenienceFeeKobo = &n },
		"min above max": func(p *ProductInput) {
			lo, hi := int64(900), int64(100)
			p.MinAmountKobo, p.MaxAmountKobo = &lo, &hi
		},
	}
	for name, mutate := range bad {
		t.Run(name, func(t *testing.T) {
			in := valid()
			mutate(&in)
			if err := validateProductInput(&in); err == nil {
				t.Error("want a validation error, got nil")
			}
		})
	}
}

// A patch that touches only ONE bound must still be checked against the bound it
// did not touch — otherwise patching the minimum alone can silently push it past
// an existing maximum and make the product unbuyable at every amount.
func TestValidateProductBounds_ChecksThePostPatchShape(t *testing.T) {
	lo, hi := int64(100), int64(1000)
	before := &ProductRow{MinAmountKobo: &lo, MaxAmountKobo: &hi}

	tooHigh := int64(5000)
	if err := validateProductBounds(before, ProductPatch{MinAmountKobo: &tooHigh}); err == nil {
		t.Error("raising min past the UNTOUCHED max must be rejected")
	}

	ok := int64(500)
	if err := validateProductBounds(before, ProductPatch{MinAmountKobo: &ok}); err != nil {
		t.Errorf("a min inside the existing max must pass: %v", err)
	}

	// Clearing the max removes the ceiling, so the same min is then fine.
	if err := validateProductBounds(before, ProductPatch{MinAmountKobo: &tooHigh, ClearMaxAmountKobo: true}); err != nil {
		t.Errorf("clearing the max must lift the constraint: %v", err)
	}
}

func TestValidateCategoryList(t *testing.T) {
	if err := validateCategoryList([]string{"airtime", "data", "cable_tv"}); err != nil {
		t.Errorf("the six-value vocabulary must pass: %v", err)
	}
	if err := validateCategoryList([]string{"airtime", "water"}); err == nil {
		t.Error("an unknown category must be rejected")
	}
	if err := validateCategoryList(nil); err != nil {
		t.Errorf("an empty list must pass: %v", err)
	}
}

func TestRequireNonBlank_TrimsAndRejectsWhitespace(t *testing.T) {
	blank := "   "
	if err := requireNonBlank(&blank, "name"); err == nil {
		t.Error("a whitespace-only NOT NULL text column must be rejected")
	}

	padded := "  VTpass  "
	if err := requireNonBlank(&padded, "name"); err != nil {
		t.Fatalf("a real value must pass: %v", err)
	}
	if padded != "VTpass" {
		t.Errorf("value = %q, want it trimmed in place", padded)
	}

	// A nil pointer is "not being changed" and must be left alone.
	if err := requireNonBlank((*string)(nil), "name"); err != nil {
		t.Errorf("an absent field must pass: %v", err)
	}
}

// ── Audit hook ───────────────────────────────────────────────────────────────

// recordingAuditor captures LogAction calls for assertion.
type recordingAuditor struct{ calls []auditCall }

type auditCall struct {
	actor, action, module, resourceType, resourceID string
	oldValues, newValues                            map[string]any
	severity                                        string
}

func (a *recordingAuditor) LogAction(actorUserID, _, action, module, resourceType, resourceID string,
	oldValues, newValues map[string]any, _, _, severity string) {
	a.calls = append(a.calls, auditCall{actorUserID, action, module, resourceType, resourceID,
		oldValues, newValues, severity})
}

// The whole point of the nil guard: every existing test builds a Service without
// an Auditor, and a mutation must not panic because of it.
func TestServiceLog_IsNilSafe(t *testing.T) {
	s := NewService(Deps{}) // no Auditor
	s.log("actor", actionProviderCreate, resourceProvider, "id", nil, map[string]any{"a": 1})
	// Reaching here without a panic is the assertion.
}

func TestServiceLog_ForwardsTheFullAuditShape(t *testing.T) {
	rec := &recordingAuditor{}
	s := NewService(Deps{Auditor: rec})

	s.log("admin-1", actionProviderUpdate, resourceProvider, "provider-9",
		map[string]any{"status": "active"}, map[string]any{"status": "disabled"})

	if len(rec.calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(rec.calls))
	}
	got := rec.calls[0]
	if got.actor != "admin-1" {
		t.Errorf("actor = %q, want admin-1", got.actor)
	}
	if got.action != "utilitybills.provider.update" {
		t.Errorf("action = %q", got.action)
	}
	if got.module != "utilitybills" {
		t.Errorf("module = %q, want utilitybills", got.module)
	}
	if auditModule != "utilitybills" {
		t.Errorf("auditModule constant = %q, want utilitybills", auditModule)
	}
	if got.resourceType != "utility_provider" {
		t.Errorf("resourceType = %q", got.resourceType)
	}
	if got.resourceID != "provider-9" {
		t.Errorf("resourceID = %q", got.resourceID)
	}
	if got.severity != "info" {
		t.Errorf("severity = %q, want info", got.severity)
	}
	// An UPDATE must carry both sides — an audit row with a nil oldValues cannot
	// answer "what did this used to be?".
	if got.oldValues["status"] != "active" || got.newValues["status"] != "disabled" {
		t.Errorf("old/new = %v / %v", got.oldValues, got.newValues)
	}
}

// The action-name vocabulary is a contract with whoever reads the audit log.
func TestAuditActionNames(t *testing.T) {
	want := map[string]string{
		actionProviderCreate:      "utilitybills.provider.create",
		actionProviderUpdate:      "utilitybills.provider.update",
		actionProviderCredsRotate: "utilitybills.provider.credentials_rotate",
		actionProviderHealthCheck: "utilitybills.provider.health_check",
		actionBillerCreate:        "utilitybills.biller.create",
		actionBillerUpdate:        "utilitybills.biller.update",
		actionProductCreate:       "utilitybills.product.create",
		actionProductUpdate:       "utilitybills.product.update",
		actionProductImport:       "utilitybills.product.import",
		actionMappingCreate:       "utilitybills.mapping.create",
		actionMappingUpdate:       "utilitybills.mapping.update",
		actionRoutingRuleCreate:   "utilitybills.routing_rule.create",
		actionRoutingRuleUpdate:   "utilitybills.routing_rule.update",
		actionCategoryCreate:      "utilitybills.category.create",
		actionCategoryUpdate:      "utilitybills.category.update",
		actionTransactionReverse:  "utilitybills.transaction.reverse",
		actionDisputeResolve:      "utilitybills.dispute.resolve",
		actionSweepTrigger:        "utilitybills.sweep.trigger",
	}
	for got, expected := range want {
		if got != expected {
			t.Errorf("action constant = %q, want %q", got, expected)
		}
	}
}

// A credentials rotation's audit row must name the KEYS and never the values.
func TestCredentialFieldNames_NamesKeysOnly(t *testing.T) {
	names := credentialFieldNames(map[string]any{
		"secret_key": "sk_live_SUPERSECRET",
		"api_key":    "ak_live_ALSOSECRET",
	})
	if len(names) != 2 || names[0] != "api_key" || names[1] != "secret_key" {
		t.Fatalf("names = %v, want [api_key secret_key] (sorted)", names)
	}
	for _, n := range names {
		if strings.Contains(n, "SECRET") {
			t.Fatalf("a credential VALUE leaked into the audit field list: %q", n)
		}
	}
}

// ── CSV export ───────────────────────────────────────────────────────────────

func TestJSONObjectKeys_PreservesDocumentOrderAndSkipsNesting(t *testing.T) {
	raw := json.RawMessage(`{"id":"a","nested":{"inner":1,"deeper":{"x":2}},"list":[{"y":3}],"last":true}`)
	got := jsonObjectKeys(raw)
	want := []string{"id", "nested", "list", "last"}
	if len(got) != len(want) {
		t.Fatalf("keys = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			// A nested key leaking in here would become a phantom CSV column.
			t.Fatalf("keys = %v, want %v", got, want)
		}
	}
}

func TestCSVColumns_UnionInFirstSeenOrder(t *testing.T) {
	elements := []json.RawMessage{
		json.RawMessage(`{"id":"1","status":"successful"}`),
		json.RawMessage(`{"id":"2","status":"failed","token":"abc"}`),
	}
	got := csvColumns(elements)
	want := []string{"id", "status", "token"}
	for i := range want {
		if i >= len(got) || got[i] != want[i] {
			t.Fatalf("columns = %v, want %v", got, want)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("columns = %v, want %v", got, want)
	}
}

func TestCSVCell(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{nil, ""},          // a NULL column is an empty cell
		{"plain", "plain"}, //
		{json.Number("9007199254740993"), "9007199254740993"}, // exact, never via float
		{true, "true"},                          //
		{map[string]any{"k": "v"}, `{"k":"v"}`}, // a nested object becomes JSON text
	}
	for _, tc := range cases {
		if got := csvCell(tc.in); got != tc.want {
			t.Errorf("csvCell(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// End-to-end through the Gin writer: headers, CRLF line endings, quoting, and
// the empty-report case.
func TestWriteCSV_RendersHeadersAndRows(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("rows", func(t *testing.T) {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodGet, "/?format=csv", nil)

		writeCSV(c, "utility-profitability.csv", []*ProfitabilityReport{{
			TotalTransactions:         3,
			GrossTransactionValueKobo: 1_500_000,
			ProviderCostKobo:          1_400_000,
			GrossProfitKobo:           100_000,
		}})

		if ct := rec.Header().Get("Content-Type"); ct != "text/csv; charset=utf-8" {
			t.Errorf("Content-Type = %q", ct)
		}
		if cd := rec.Header().Get("Content-Disposition"); cd != `attachment; filename="utility-profitability.csv"` {
			t.Errorf("Content-Disposition = %q", cd)
		}

		body := rec.Body.String()
		want := "total_transactions,gross_transaction_value_kobo,provider_cost_kobo,gross_profit_kobo\r\n" +
			"3,1500000,1400000,100000\r\n"
		if body != want {
			t.Errorf("body = %q\nwant       %q", body, want)
		}
	})

	t.Run("quotes embedded commas", func(t *testing.T) {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodGet, "/?format=csv", nil)

		ref := "REF,WITH,COMMAS"
		writeCSV(c, "x.csv", []ReconciliationRow{{ID: "t1", ProviderReference: &ref}})

		if !strings.Contains(rec.Body.String(), `"REF,WITH,COMMAS"`) {
			t.Errorf("a value containing commas must be quoted; body = %q", rec.Body.String())
		}
	})

	t.Run("empty report is an empty body", func(t *testing.T) {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodGet, "/?format=csv", nil)

		writeCSV(c, "x.csv", []ReconciliationRow{})

		// Matches toCsv()'s `if (rows.length === 0) return ''` — not a lone header.
		if body := rec.Body.String(); body != "" {
			t.Errorf("body = %q, want empty", body)
		}
	})
}

// A nil *int64 must render as an empty cell, not "null" or "0" — the difference
// between "no maximum configured" and "a maximum of zero".
func TestWriteCSV_NullColumnsAreEmptyCells(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/?format=csv", nil)

	writeCSV(c, "x.csv", []ReconciliationRow{{ID: "t1", Category: "airtime"}}) // pointers left nil

	lines := strings.Split(strings.TrimSuffix(rec.Body.String(), "\r\n"), "\r\n")
	if len(lines) != 2 {
		t.Fatalf("lines = %v", lines)
	}
	header := strings.Split(lines[0], ",")
	row := strings.Split(lines[1], ",")
	for i, col := range header {
		if col == "receipt_number" || col == "provider_id" || col == "provider_reference" {
			if row[i] != "" {
				t.Errorf("column %s = %q, want an empty cell for a NULL", col, row[i])
			}
		}
	}
}
