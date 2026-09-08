package mycover

import (
	"encoding/json"
	"testing"
)

// MyCover nests shapes under `child_data`. The parser also tolerates the
// conventional JSON-Schema-ish names, but this provider never emits them, so
// reading only those dropped every nested field: 64 of the 68 live products
// publish a `policy_holder` object and 17 publish repeating arrays, all under
// child_data. A dropped nesting is silent — the form simply renders without the
// block — which is why it survived until now and why it is pinned here.
func TestConvertFields_ReadsChildData(t *testing.T) {
	raw := []byte(`[
	  {"name":"first_name","label":"First Name","type":"string","required":true},
	  {"name":"policy_holder","label":"Policy Holder","type":"object","required":false,
	   "child_data":[
	     {"name":"email","label":"Email","type":"string","required":true},
	     {"name":"gender","label":"Gender","type":"string","required":true,
	      "validation":{"type":"string","enum":["Male","Female"]}}
	   ]},
	  {"name":"general_contents","label":"General Contents","type":"array","required":false,
	   "child_data":[
	     {"name":"item","label":"Item","type":"string","required":true},
	     {"name":"value","label":"Value","type":"number","required":true,
	      "validation":{"type":"number","minimum":1000}}
	   ]}
	]`)

	var fields []rawSchemaField
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got := convertFields(fields)
	if len(got) != 3 {
		t.Fatalf("want 3 top-level fields, got %d", len(got))
	}

	byName := map[string]Field{}
	for _, f := range got {
		byName[f.Name] = f
	}

	holder, ok := byName["policy_holder"]
	if !ok {
		t.Fatal("policy_holder missing")
	}
	if holder.Type != "object" {
		t.Errorf("policy_holder type = %q, want object", holder.Type)
	}
	if len(holder.Children) != 2 {
		t.Fatalf("policy_holder children = %d, want 2 (child_data was dropped)", len(holder.Children))
	}
	if holder.Children[0].Name != "email" {
		t.Errorf("first child = %q, want email", holder.Children[0].Name)
	}
	// Nested enums must survive the descent, or a nested gender renders as a
	// free-text box and the insurer rejects whatever the member types.
	if g := holder.Children[1]; g.Type != "select" || len(g.Options) != 2 {
		t.Errorf("nested gender = type %q with %d options, want select with 2", g.Type, len(g.Options))
	}

	contents, ok := byName["general_contents"]
	if !ok {
		t.Fatal("general_contents missing")
	}
	// An array whose row shape is known is a repeating GROUP. Without children it
	// falls back to multiselect, which is a completely different control.
	if contents.Type != "array" {
		t.Errorf("general_contents type = %q, want array", contents.Type)
	}
	if len(contents.Children) != 2 {
		t.Fatalf("general_contents children = %d, want 2", len(contents.Children))
	}
}

// The fallback chain still works, so a future provider that normalises its
// vocabulary keeps parsing without a code change.
func TestConvertFields_FallsBackToConventionalNestingKeys(t *testing.T) {
	for _, key := range []string{"children", "properties", "items"} {
		t.Run(key, func(t *testing.T) {
			raw := []byte(`[{"name":"group","label":"Group","type":"object","` + key +
				`":[{"name":"inner","label":"Inner","type":"string","required":true}]}]`)
			var fields []rawSchemaField
			if err := json.Unmarshal(raw, &fields); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			got := convertFields(fields)
			if len(got) != 1 || len(got[0].Children) != 1 {
				t.Fatalf("%s: children not read (got %d field(s))", key, len(got))
			}
			if got[0].Children[0].Name != "inner" {
				t.Errorf("%s: child = %q, want inner", key, got[0].Children[0].Name)
			}
		})
	}
}

// child_data wins when more than one nesting key is present, because it is the
// one this provider actually populates.
func TestConvertFields_ChildDataWinsOverOtherKeys(t *testing.T) {
	raw := []byte(`[{"name":"group","label":"Group","type":"object",
	  "child_data":[{"name":"real","label":"Real","type":"string"}],
	  "children":[{"name":"decoy","label":"Decoy","type":"string"}]}]`)
	var fields []rawSchemaField
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got := convertFields(fields)
	if len(got) != 1 || len(got[0].Children) != 1 {
		t.Fatalf("unexpected shape: %+v", got)
	}
	if got[0].Children[0].Name != "real" {
		t.Errorf("child = %q, want real (child_data must win)", got[0].Children[0].Name)
	}
}
