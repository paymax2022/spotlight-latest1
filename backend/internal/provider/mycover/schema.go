package mycover

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"spotlight/backend/internal/insurance/gateway"
)

// ════════════════════════════════════════════════════════════════════════════
// FORM SCHEMA — fetched from the provider, never hand-maintained
// ════════════════════════════════════════════════════════════════════════════
//
// GET /public-product-details/{product_id} returns the complete, machine-readable
// field table for a product: name, label, type, required, description, the data
// source (a literal enum or a utility URL), and full validation rules. It is what
// docs.mycover.ai itself renders, and it needs NO AUTHENTICATION.
//
// This is the endpoint that makes "adding a product is a data change" true in the
// strong sense: there is no table of fields in this repo to drift out of date.
// The sync fetches the schema, translates it into the internal Field contract,
// and stores it. A product MyCover adds tomorrow arrives with its own form.
//
// ⚠️ This endpoint is NOT enveloped. It returns a BARE JSON object with no
// responseCode — unlike every other endpoint on the API.

// ProductSchema is the normalised, contract-shaped form definition for one
// product, plus what we learned about whether it can actually be sold.
type ProductSchema struct {
	ProductID string  `json:"product_id"`
	Fields    []Field `json:"fields"`
	// SamplePayload is MyCover's own example body, kept for support and for
	// debugging a rejected purchase.
	SamplePayload map[string]any `json:"sample_payload,omitempty"`
	// Utilities are the dropdown sources this product's fields draw on.
	Utilities []Utility `json:"utilities,omitempty"`
}

// Field mirrors the internal FormSchema contract the mobile app renders from.
type Field struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
	Help     string `json:"help,omitempty"`

	MinLength int          `json:"min_length,omitempty"`
	MaxLength int          `json:"max_length,omitempty"`
	Min       *json.Number `json:"min,omitempty"`
	Max       *json.Number `json:"max,omitempty"`

	// Unit qualifies Min/Max on a `money` field. It is always
	// gateway.MoneyUnitKobo: the provider states its minimums in naira, but the
	// internal contract is kobo end to end, so the bound is scaled here and
	// LABELLED so a client that ignores `unit` still enforces it at the right
	// magnitude. Empty on every non-money field.
	Unit string `json:"unit,omitempty"`

	Options []Option `json:"options,omitempty"`
	// OptionsURL is a provider utility endpoint supplying the options. When the
	// field also has DependsOn.QueryParam, the parent's value is passed as
	// ?query=… — several MyCover utilities serve double duty this way (one id
	// returns Nigerian states with no query and that state's LGAs with one).
	OptionsURL string     `json:"options_url,omitempty"`
	DependsOn  *DependsOn `json:"depends_on,omitempty"`

	// Children carries the shape of a nested object or a repeating array row.
	// The internal contract needs this: ~65 products have a `policy_holder`
	// object and 17 have repeating groups (office_items[], cargo_details[],
	// beneficiaries[]).
	Children []Field `json:"children,omitempty"`

	// System marks a field the ADAPTER fills, never the member — product_id is
	// present on every schema and is emitted as `hidden` so no form renders it.
	System bool `json:"system,omitempty"`

	// MyCoverType preserves the provider's own type token so nothing is lost in
	// translation and a mis-mapping can be diagnosed without re-probing.
	MyCoverType string `json:"mycover_type,omitempty"`
}

// Option is one choice in a select.
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// DependsOn describes a field whose options depend on another field's value.
type DependsOn struct {
	Field      string `json:"field"`
	Equals     any    `json:"equals,omitempty"`
	QueryParam string `json:"query_param,omitempty"`
}

// Utility is a provider dropdown source referenced by a schema.
type Utility struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
	URL  string `json:"url,omitempty"`
}

// --- provider JSON (never leaves this file) ---

type publicProductDetails struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	ProductTable   []rawSchemaField  `json:"product_table_data"`
	SamplePayload  map[string]any    `json:"sample_payload"`
	ComputePayload map[string]any    `json:"compute_price_payload"`
	Utilities      []json.RawMessage `json:"utilities"`
}

type rawSchemaField struct {
	Name        string           `json:"name"`
	Label       string           `json:"label"`
	Type        string           `json:"type"`
	Required    bool             `json:"required"`
	Description string           `json:"description"`
	DataSource  json.RawMessage  `json:"data_source"`
	Validation  json.RawMessage  `json:"validation"`
	Children    []rawSchemaField `json:"children"`
	Properties  []rawSchemaField `json:"properties"`
	Items       []rawSchemaField `json:"items"`
}

type rawValidation struct {
	Type      string `json:"type"`
	MinLength *int   `json:"min_length"`
	MaxLength *int   `json:"max_length"`
	// Bounds are decoded as json.Number, never float64: a money bound is scaled
	// by 100 on its way into the published contract and float64 arithmetic is
	// banned from every money path.
	Min     *json.Number    `json:"min"`
	Max     *json.Number    `json:"max"`
	Minimum *json.Number    `json:"minimum"`
	Maximum *json.Number    `json:"maximum"`
	Enum    json.RawMessage `json:"enum"`
	Options json.RawMessage `json:"options"`
	Format  string          `json:"format"`
	Pattern string          `json:"pattern"`
}

// ProductSchemaFor fetches and normalises one product's form schema.
//
// It sends NO Authorization header: the endpoint is public, and not sending a
// credential where none is required is the right default.
func (c *Client) ProductSchemaFor(ctx context.Context, productID string) (*ProductSchema, error) {
	if productID == "" {
		return nil, fmt.Errorf("mycover: empty product id")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+pathPublicProductDetails+url.PathEscape(productID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mycover: product details: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mycover: product details for %s: http %d", productID, resp.StatusCode)
	}

	// NOTE: bare object, NOT the {responseCode,responseText,data} envelope every
	// other endpoint uses.
	var d publicProductDetails
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, fmt.Errorf("mycover: decode product details for %s: %w", productID, err)
	}

	out := &ProductSchema{
		ProductID:     productID,
		Fields:        convertFields(d.ProductTable),
		SamplePayload: d.SamplePayload,
	}
	return out, nil
}

// Purchasable reports whether a schema describes a product that can actually be
// sold. MyCover ships 7 products (of 69) whose purchase configuration is broken;
// four of them return a schema containing NOTHING but product_id.
//
// A form with no member-fillable field is the tell: there is nothing to collect,
// so there is nothing to buy. Listing such a product is fine; selling it would
// take money for cover that cannot be issued.
func (s *ProductSchema) Purchasable() bool {
	if s == nil {
		return false
	}
	for _, f := range s.Fields {
		if !f.System {
			return true
		}
	}
	return false
}

// AsMap renders the schema in the shape the internal contract publishes,
// {"fields": [...]}, for storage as jsonb and for the member schema endpoint.
func (s *ProductSchema) AsMap() map[string]any {
	if s == nil {
		return map[string]any{"fields": []any{}}
	}
	b, err := json.Marshal(map[string]any{
		"fields":         s.Fields,
		"sample_payload": s.SamplePayload,
	})
	if err != nil {
		return map[string]any{"fields": []any{}}
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return map[string]any{"fields": []any{}}
	}
	return m
}

func convertFields(raw []rawSchemaField) []Field {
	out := make([]Field, 0, len(raw))
	for _, rf := range raw {
		if rf.Name == "" {
			continue
		}
		out = append(out, convertField(rf))
	}
	return out
}

func convertField(rf rawSchemaField) Field {
	v := parseValidation(rf.Validation)

	f := Field{
		Name:        rf.Name,
		Label:       firstNonEmpty(rf.Label, humanise(rf.Name)),
		Required:    rf.Required,
		Help:        rf.Description,
		MyCoverType: rf.Type,
	}
	if v != nil {
		if v.MinLength != nil {
			f.MinLength = *v.MinLength
		}
		if v.MaxLength != nil {
			f.MaxLength = *v.MaxLength
		}
		f.Min = firstNonNilNumber(v.Min, v.Minimum)
		f.Max = firstNonNilNumber(v.Max, v.Maximum)
		f.Options = parseOptions(v.Enum, v.Options)
	}
	if len(f.Options) == 0 {
		f.Options, f.OptionsURL = parseDataSource(rf.DataSource)
	}

	// Nested shapes: an object's properties, an array row's items.
	children := rf.Children
	if len(children) == 0 {
		children = rf.Properties
	}
	if len(children) == 0 {
		children = rf.Items
	}
	if len(children) > 0 {
		f.Children = convertFields(children)
	}

	f.Type = mapFieldType(rf, v, f)

	// MONEY BOUNDARY (bounds). The provider states its minimums in NAIRA —
	// `value >= 100000` means ₦100,000 — while the internal contract carries
	// money in KOBO. Publishing the bound unscaled made the minimum 100x too
	// lenient: a client reading the contract's kobo default validated ₦100,000
	// as ₦1,000. Scale it exactly once, here, and say which unit it is in.
	if f.Type == gateway.FieldTypeMoney {
		f.Min = boundToKobo(f.Min)
		f.Max = boundToKobo(f.Max)
		f.Unit = gateway.MoneyUnitKobo
	}

	// product_id is on every schema and must never be rendered — the adapter
	// fills it from the catalog row.
	if rf.Name == FieldProductID {
		f.Type = "hidden"
		f.System = true
	}
	return f
}

// mapFieldType translates MyCover's coarse type vocabulary (string, number,
// boolean, object, array, integer) into the richer internal contract type the
// app renders a widget from.
//
// ⚠️ ONE OF THESE LABELS IS LOAD-BEARING, NOT PRESENTATIONAL.
//
// This comment used to claim the whole mapping "never changes what is sent or
// what anything costs". That was false, and the falsehood was the root cause of
// a live 100x pricing bug. `money` is the label that says a value is DENOMINATED:
// clients submit money fields in kobo because of it, and the adapter rescales
// exactly those fields to the provider's naira because of it (see
// gateway/form_money.go and money.go). Every other label here really is just a
// keyboard and a control.
//
// A name-based heuristic remains acceptable for `money` for one reason only:
// SYMMETRY. Both sides key off the SAME emitted label, so a field this function
// misclassifies is multiplied by 100 by the client and divided by 100 by the
// adapter and round-trips to identity. If you ever make one side decide for
// itself which fields are money, that property is gone and a wrong guess here
// becomes a money bug. Do not.
func mapFieldType(rf rawSchemaField, v *rawValidation, f Field) string {
	name := strings.ToLower(rf.Name)
	base := strings.ToLower(rf.Type)
	if v != nil && base == "" {
		base = strings.ToLower(v.Type)
	}

	switch base {
	case "object":
		return "object"
	case "array":
		// A repeating GROUP (rows with a shape) is an array; a plain list of
		// choices is a multiselect.
		if len(f.Children) > 0 {
			return "array"
		}
		return "multiselect"
	case "boolean":
		// Rendered as a two-option select so yes/no reads like every other choice.
		return "select"
	}

	// Anything with a fixed option set is a select regardless of its base type.
	if len(f.Options) > 0 || f.OptionsURL != "" {
		return "select"
	}

	// Name-based refinement, most specific first.
	switch {
	case name == "email" || strings.HasSuffix(name, "_email"):
		return "email"
	case name == "nin" || strings.HasSuffix(name, "_nin"):
		return "nin"
	case strings.Contains(name, "phone"):
		return "phone"
	case strings.Contains(name, "address"):
		return "address"
	case strings.HasPrefix(name, "date_") || strings.HasSuffix(name, "_date") || name == "date":
		return "date"
	case strings.HasSuffix(name, "image_url") || strings.Contains(name, "photo") || strings.Contains(name, "picture"):
		return "image"
	case strings.HasSuffix(name, "_url"):
		// Other *_url fields are document uploads, not free-text URLs.
		return "file"
	}
	if v != nil && v.Format != "" {
		switch strings.ToLower(v.Format) {
		case "email":
			return "email"
		case "date", "date-time", "iso8601":
			return "date"
		case "uri", "url":
			return "file"
		}
	}

	if base == "number" || base == "integer" {
		// Money-ish names get the money widget; other numbers stay numeric.
		if strings.Contains(name, "value") || strings.Contains(name, "amount") ||
			strings.Contains(name, "price") || strings.Contains(name, "sum") ||
			strings.Contains(name, "premium") || strings.Contains(name, "income") ||
			strings.Contains(name, "salary") || strings.Contains(name, "loan") {
			return "money"
		}
		return "number"
	}
	return "text"
}

func parseValidation(raw json.RawMessage) *rawValidation {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var v rawValidation
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return &v
}

// parseOptions reads a literal option list from either an `enum` or an `options`
// field, accepting both ["a","b"] and [{"label":…,"value":…}].
func parseOptions(candidates ...json.RawMessage) []Option {
	for _, raw := range candidates {
		if len(raw) == 0 || string(raw) == "null" {
			continue
		}
		var plain []string
		if err := json.Unmarshal(raw, &plain); err == nil && len(plain) > 0 {
			out := make([]Option, 0, len(plain))
			for _, s := range plain {
				out = append(out, Option{Value: s, Label: s})
			}
			return out
		}
		var labelled []struct {
			Label string          `json:"label"`
			Value json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(raw, &labelled); err == nil && len(labelled) > 0 {
			out := make([]Option, 0, len(labelled))
			for _, o := range labelled {
				val := jsonNumberOrString(o.Value)
				out = append(out, Option{Value: val, Label: firstNonEmpty(o.Label, val)})
			}
			return out
		}
	}
	return nil
}

// parseDataSource reads MyCover's `data_source`, which is either prose
// ("User input"), a literal option list, or a utility URL the app must call to
// populate the dropdown.
func parseDataSource(raw json.RawMessage) ([]Option, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		s = strings.TrimSpace(s)
		if s == "" || strings.EqualFold(s, "user input") {
			return nil, ""
		}
		if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "/") {
			return nil, s
		}
		// A comma-separated literal list, e.g. "Male, Female".
		if strings.Contains(s, ",") {
			parts := strings.Split(s, ",")
			out := make([]Option, 0, len(parts))
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if p != "" {
					out = append(out, Option{Value: p, Label: p})
				}
			}
			if len(out) > 1 {
				return out, ""
			}
		}
		return nil, ""
	}
	if opts := parseOptions(raw); len(opts) > 0 {
		return opts, ""
	}
	var obj struct {
		URL     string          `json:"url"`
		Options json.RawMessage `json:"options"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil {
		if opts := parseOptions(obj.Options); len(opts) > 0 {
			return opts, ""
		}
		return nil, obj.URL
	}
	return nil, ""
}

func firstNonNilNumber(vals ...*json.Number) *json.Number {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

// humanise turns a snake_case field name into a readable label, for the rare
// field MyCover ships without one.
func humanise(name string) string {
	parts := strings.Split(strings.ReplaceAll(name, "-", "_"), "_")
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}

// boundToKobo rescales a money field's naira bound to the kobo the internal
// contract publishes. Exact decimal arithmetic (NairaToKobo) — never float64.
//
// A bound we cannot scale exactly is DROPPED rather than published at the wrong
// magnitude: no minimum is honest, and a 100x-lenient one is a money bug wearing
// a validation rule's clothes.
func boundToKobo(n *json.Number) *json.Number {
	if n == nil {
		return nil
	}
	kobo, err := NairaToKobo(n.String())
	if err != nil {
		return nil
	}
	out := json.Number(strconv.FormatInt(kobo, 10))
	return &out
}
