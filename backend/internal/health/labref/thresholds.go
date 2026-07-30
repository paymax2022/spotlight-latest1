package labref

import "strings"

// criticalThreshold is a panic/critical-value band for an analyte, in a canonical
// unit. A value at or beyond Low/High is a critical result (mandatory escalation,
// LR-003). These are illustrative, widely-cited adult panic values — the curated
// golden ruleset a lab's accredited reference data replaces.
type criticalThreshold struct {
	Low  float64
	High float64
	Unit string
}

// criticalThresholds is keyed by normalized analyte name/code.
var criticalThresholds = map[string]criticalThreshold{
	"potassium":   {Low: 2.5, High: 6.0, Unit: "mmol/l"},
	"k":           {Low: 2.5, High: 6.0, Unit: "mmol/l"},
	"sodium":      {Low: 120, High: 160, Unit: "mmol/l"},
	"na":          {Low: 120, High: 160, Unit: "mmol/l"},
	"glucose":     {Low: 2.2, High: 25.0, Unit: "mmol/l"},
	"calcium":     {Low: 1.6, High: 3.5, Unit: "mmol/l"},
	"hemoglobin":  {Low: 5.0, High: 20.0, Unit: "g/dl"},
	"haemoglobin": {Low: 5.0, High: 20.0, Unit: "g/dl"},
	"hgb":         {Low: 5.0, High: 20.0, Unit: "g/dl"},
	"platelet":    {Low: 20, High: 1000, Unit: "10^9/l"},
	"platelets":   {Low: 20, High: 1000, Unit: "10^9/l"},
	"creatinine":  {Low: 0, High: 500, Unit: "umol/l"},
	"inr":         {Low: 0, High: 5.0, Unit: ""},
}

// criticalFor returns the critical threshold for an analyte, matching the test
// name/code case-insensitively (exact key, then a word-contains fallback so
// "Serum Potassium" matches "potassium").
func criticalFor(analyte string) (criticalThreshold, bool) {
	a := strings.ToLower(strings.TrimSpace(analyte))
	if th, ok := criticalThresholds[a]; ok {
		return th, true
	}
	for key, th := range criticalThresholds {
		if len(key) >= 4 && strings.Contains(a, key) {
			return th, true
		}
	}
	return criticalThreshold{}, false
}
