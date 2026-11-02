package gateway

import (
	"reflect"
	"testing"
)

// A provider field with an enumerated option list is published as a `select` so
// the client renders a dropdown — but its ANSWER still has the provider's type.
// payment_plan is a number (1..12) and bought_for_self is a boolean; sending the
// option's label ("1", "true") as a string is rejected by the provider's
// validator ("/payment_plan must be number").
func TestProviderTypedInputPaths_SeparatesNumbersAndBooleans(t *testing.T) {
	schema := decodeSchema(t, `{"fields":[
		{"name":"payment_plan","type":"select","mycover_type":"number","min":1,"max":12},
		{"name":"bought_for_self","type":"select","mycover_type":"boolean"},
		{"name":"benefits","type":"multiselect","mycover_type":"array"},
		{"name":"hmo_id","type":"text","mycover_type":"string"},
		{"name":"version","type":"number"},
		{"name":"policy_holder","type":"object","children":[
			{"name":"first_name","type":"text","mycover_type":"string"},
			{"name":"age","type":"number","mycover_type":"integer"}
		]},
		{"name":"office_items","type":"array","children":[
			{"name":"headcount","type":"select","mycover_type":"number"}
		]}
	]}`)

	if got, want := NumberInputPaths(schema), []string{"office_items.headcount", "payment_plan", "policy_holder.age", "version"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("number paths = %v, want %v", got, want)
	}
	if got, want := BooleanInputPaths(schema), []string{"bought_for_self"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("boolean paths = %v, want %v", got, want)
	}
}
