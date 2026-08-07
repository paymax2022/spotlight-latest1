package clinicalsafety

import "strings"

// This file is the curated golden knowledge base — the replaceable seam. Every
// map is keyed by a normalized (lower-cased, single-spaced) drug or class token.
// A production build swaps these tables for a licensed drug-database adapter; the
// engine logic in engine.go is unchanged.

// drugSynonym normalizes trade/alt names to a canonical generic name.
var drugSynonym = map[string]string{
	"acetaminophen":        "paracetamol",
	"tylenol":              "paracetamol",
	"asa":                  "aspirin",
	"acetylsalicylic acid": "aspirin",
	"glyceryl trinitrate":  "nitroglycerin",
	"gtn":                  "nitroglycerin",
}

// drugClass maps a canonical drug name to its therapeutic/allergy class.
var drugClass = map[string]string{
	"amoxicillin":            "penicillin",
	"ampicillin":             "penicillin",
	"penicillin":             "penicillin",
	"flucloxacillin":         "penicillin",
	"azithromycin":           "macrolide",
	"erythromycin":           "macrolide",
	"clarithromycin":         "macrolide",
	"ibuprofen":              "nsaid",
	"naproxen":               "nsaid",
	"diclofenac":             "nsaid",
	"aspirin":                "nsaid",
	"paracetamol":            "analgesic_apap",
	"warfarin":               "anticoagulant",
	"sildenafil":             "pde5",
	"tadalafil":              "pde5",
	"isosorbide dinitrate":   "nitrate",
	"isosorbide mononitrate": "nitrate",
	"nitroglycerin":          "nitrate",
	"lisinopril":             "acei",
	"ramipril":               "acei",
	"enalapril":              "acei",
	"sertraline":             "ssri",
	"fluoxetine":             "ssri",
	"citalopram":             "ssri",
	"loratadine":             "antihistamine",
	"cetirizine":             "antihistamine",
	"sulfamethoxazole":       "sulfonamide",
	"metformin":              "biguanide",
}

// allergyAlias maps a free-text allergy term to the drug class it implicates, so
// "penicillin"/"sulfa" etc. cross-react with every drug in that class.
var allergyAlias = map[string]string{
	"penicillin":   "penicillin",
	"penicillins":  "penicillin",
	"sulfa":        "sulfonamide",
	"sulfur":       "sulfonamide",
	"sulphonamide": "sulfonamide",
	"sulfonamide":  "sulfonamide",
	"nsaid":        "nsaid",
	"nsaids":       "nsaid",
	"aspirin":      "nsaid",
	"macrolide":    "macrolide",
}

// interactionRule is an unordered pair of tokens (drug names or classes) with a
// severity. Tokens are matched against each drug's {name, class} token set.
type interactionRule struct {
	a, b     string
	severity Severity
	message  string
}

var interactionRules = []interactionRule{
	{"anticoagulant", "nsaid", SeverityMajor, "Increased bleeding risk (anticoagulant + NSAID)."},
	{"anticoagulant", "aspirin", SeverityMajor, "Increased bleeding risk (anticoagulant + aspirin)."},
	{"nitrate", "pde5", SeverityContraindicated, "Life-threatening hypotension (nitrate + PDE5 inhibitor)."},
	{"ssri", "maoi", SeverityContraindicated, "Serotonin syndrome risk (SSRI + MAOI)."},
	{"acei", "potassium", SeverityModerate, "Hyperkalemia risk (ACE inhibitor + potassium)."},
	{"macrolide", "warfarin", SeverityMajor, "Macrolides potentiate warfarin (bleeding risk)."},
	{"pde5", "nitrate", SeverityContraindicated, "Life-threatening hypotension (PDE5 inhibitor + nitrate)."},
}

// doseLimit caps a drug's single dose. MaxSingleMg is the adult single-dose cap;
// MaxMgPerKg is the per-dose weight-based cap applied whenever weight is known.
type doseLimit struct {
	MaxSingleMg float64
	MaxMgPerKg  float64
}

var doseLimits = map[string]doseLimit{
	"paracetamol": {MaxSingleMg: 1000, MaxMgPerKg: 15},
	"ibuprofen":   {MaxSingleMg: 800, MaxMgPerKg: 10},
	"amoxicillin": {MaxSingleMg: 1000, MaxMgPerKg: 30},
}

// duplicableClasses are therapeutic classes where two concurrent agents is a
// duplicate-therapy concern (surfaced, not hard-stopped).
var duplicableClasses = map[string]bool{
	"nsaid": true, "ssri": true, "acei": true, "anticoagulant": true, "pde5": true,
}

// speciesToxic lists substances (drug name or class token) toxic to a species —
// a hard block for that species.
var speciesToxic = map[string]map[string]bool{
	"cat": {"paracetamol": true, "analgesic_apap": true, "aspirin": true, "ibuprofen": true, "nsaid": true, "xylitol": true, "permethrin": true},
	"dog": {"xylitol": true, "ibuprofen": true, "grapes": true, "chocolate": true, "theobromine": true},
}

// humanOnlyForPets are human medicines blocked for any non-human species by
// policy unless a licensed vet records an override.
var humanOnlyForPets = map[string]bool{
	"ibuprofen": true, "naproxen": true, "diclofenac": true, "paracetamol": true,
}

// normDrug lowercases, collapses internal whitespace, and applies the synonym map.
func normDrug(name string) string {
	n := strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(name))), " ")
	if canon, ok := drugSynonym[n]; ok {
		return canon
	}
	return n
}

// classOf returns the therapeutic/allergy class for a drug ("" if unknown).
func classOf(drug string) string { return drugClass[normDrug(drug)] }

// tokensOf returns the {name, class} token set for a drug (for interaction matching).
func tokensOf(drug string) []string {
	n := normDrug(drug)
	toks := []string{n}
	if c := drugClass[n]; c != "" {
		toks = append(toks, c)
	}
	return toks
}
