package mycover

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// coerceTypedInputs rewrites the answers the provider's schema still types even
// though it publishes them as dropdowns. A select's value is a label ("12",
// "true"), and MyCover's validator rejects
// "/payment_plan must be number, /bought_for_self must be boolean" when that
// label reaches compute-price or buy as a string.
//
// `in` is the copy ConvertMoneyInputsToNaira already returned, so mutating it
// cannot change the answers stored with the quote and replayed at bind time.
// It FAILS CLOSED: a value that cannot become the declared type stops the call
// rather than reaching the provider as the wrong type.
func coerceTypedInputs(in map[string]any, numberPaths, booleanPaths []string) error {
	numbers := pathSet(numberPaths)
	booleans := pathSet(booleanPaths)
	if len(numbers) == 0 && len(booleans) == 0 {
		return nil
	}
	return coerceTypedMap(in, "", numbers, booleans)
}

func pathSet(paths []string) map[string]struct{} {
	if len(paths) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		if p != "" {
			set[p] = struct{}{}
		}
	}
	return set
}

func coerceTypedMap(in map[string]any, prefix string, numbers, booleans map[string]struct{}) error {
	for k, v := range in {
		path := k
		if prefix != "" {
			path = prefix + "." + k
		}
		if _, ok := numbers[path]; ok {
			n, err := providerNumber(v)
			if err != nil {
				return fmt.Errorf("mycover: number field %q: %w", path, err)
			}
			in[k] = n
			continue
		}
		if _, ok := booleans[path]; ok {
			b, err := providerBool(v)
			if err != nil {
				return fmt.Errorf("mycover: boolean field %q: %w", path, err)
			}
			in[k] = b
			continue
		}
		if err := coerceTypedValue(v, path, numbers, booleans); err != nil {
			return err
		}
	}
	return nil
}

// coerceTypedValue recurses into the nested shapes schemas use: an object
// (`policy_holder`) and repeating rows (`office_items[]`), where every row of
// one array shares the array's path.
func coerceTypedValue(v any, path string, numbers, booleans map[string]struct{}) error {
	switch t := v.(type) {
	case map[string]any:
		return coerceTypedMap(t, path, numbers, booleans)
	case []any:
		for _, row := range t {
			if err := coerceTypedValue(row, path, numbers, booleans); err != nil {
				return err
			}
		}
	}
	return nil
}

// providerNumber renders an answer as a JSON number. json.Number is kept
// verbatim so an integer stays an integer instead of becoming a float64.
func providerNumber(v any) (json.Number, error) {
	switch t := v.(type) {
	case json.Number:
		if !isJSONNumber(t.String()) {
			return "", fmt.Errorf("%q is not a number", t)
		}
		return t, nil
	case string:
		s := strings.TrimSpace(t)
		if !isJSONNumber(s) {
			return "", fmt.Errorf("%q is not a number", t)
		}
		return json.Number(s), nil
	case float64:
		return json.Number(strconv.FormatFloat(t, 'f', -1, 64)), nil
	case float32:
		return json.Number(strconv.FormatFloat(float64(t), 'f', -1, 32)), nil
	case int:
		return json.Number(strconv.Itoa(t)), nil
	case int32:
		return json.Number(strconv.FormatInt(int64(t), 10)), nil
	case int64:
		return json.Number(strconv.FormatInt(t, 10)), nil
	}
	return "", fmt.Errorf("%T is not a number", v)
}

func isJSONNumber(s string) bool {
	return s != "" && json.Valid([]byte(s)) && (s[0] == '-' || (s[0] >= '0' && s[0] <= '9'))
}

func providerBool(v any) (bool, error) {
	switch t := v.(type) {
	case bool:
		return t, nil
	case string:
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "true":
			return true, nil
		case "false":
			return false, nil
		}
	}
	return false, fmt.Errorf("%v is not a boolean", v)
}
