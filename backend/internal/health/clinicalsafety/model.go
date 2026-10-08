// Package clinicalsafety is a pure, deterministic clinical drug-safety engine:
// drug-allergy, drug-drug interaction, dose-range/weight, duplicate-therapy, and
// (veterinary) species-toxicity / human-only-drug checks that run BEFORE a
// prescription is issued or dispensed (test plan §4.2, §4.11; RX-002/003/004/005,
// VT-002/003/004).
// It has no I/O: callers pass an explicit PatientContext + prescribed items and
// receive structured findings. The knowledge base here is a curated golden
// ruleset (deterministic, test-anchored) — NOT a substitute for a licensed
// clinical drug database. The knowledge tables below are the seam a real
// drug-interaction vendor (First Databank, Multum, BNF, etc.) would replace
// without touching the engine or its callers.
package clinicalsafety

import (
	"fmt"
	"slices"
	"strings"
)

const (
	keyParacetamol   = "paracetamol"
	keyAspirin       = "aspirin"
	keyNitroglycerin = "nitroglycerin"
	keyPenicillin    = "penicillin"
	keyMacrolide     = "macrolide"
	keyIbuprofen     = "ibuprofen"
	keyAnticoagulant = "anticoagulant"
	keyPde5          = "pde5"
	keyNitrate       = "nitrate"
	keyAcei          = "acei"
	keySsri          = "ssri"
	keySulfonamide   = "sulfonamide"
)

// Severity ranks a finding. Contraindicated and Major are hard stops (must block
// unless a licensed clinician records a documented override reason, RX-011);
// Moderate/Minor are surfaced but do not block.
type Severity string

const (
	SeverityContraindicated Severity = "contraindicated"
	SeverityMajor           Severity = "major"
	SeverityModerate        Severity = "moderate"
	SeverityMinor           Severity = "minor"
)

// FindingKind classifies a safety finding.
type FindingKind string

const (
	KindAllergy      FindingKind = "allergy"
	KindInteraction  FindingKind = "drug_interaction"
	KindDose         FindingKind = "dose_range"
	KindDuplicate    FindingKind = "duplicate_therapy"
	KindSpeciesToxic FindingKind = "species_toxic"
	KindHumanOnly    FindingKind = "human_only_drug"
)

// Finding is one safety result for one prescribed item.
type Finding struct {
	Kind     FindingKind `json:"kind"`
	Severity Severity    `json:"severity"`
	Drug     string      `json:"drug"`
	Against  string      `json:"against,omitempty"` // the allergy/med/species it fired against
	Message  string      `json:"message"`
	HardStop bool        `json:"hardStop"` // must block unless overridden with a documented reason
}

// PatientContext is the clinical context a prescription is checked against.
// Species "" or "human" selects human rules; any other value (e.g. "cat", "dog")
// selects veterinary rules (species-toxicity + human-only-drug blocks).
type PatientContext struct {
	Species     string   `json:"species"`
	Allergies   []string `json:"allergies"`   // free-text allergy terms (drug or class)
	CurrentMeds []string `json:"currentMeds"` // active drug names
	WeightKg    float64  `json:"weightKg"`    // 0 = unknown (weight-based checks skipped)
	AgeYears    float64  `json:"ageYears"`
}

// RxItem is one prescribed line the engine evaluates.
type RxItem struct {
	DrugName string  `json:"drugName"`
	DoseMg   float64 `json:"doseMg"` // single-dose amount in mg; 0 = not provided (dose check skipped)
	Quantity int     `json:"quantity"`
}

// Result aggregates findings for a whole prescription.
type Result struct {
	Findings []Finding `json:"findings"`
	Blocked  bool      `json:"blocked"` // true if any finding is a hard stop
}

// HardStops returns only the blocking findings (used by the service override path).
func (r Result) HardStops() []Finding {
	var out []Finding
	for _, f := range r.Findings {
		if f.HardStop {
			out = append(out, f)
		}
	}
	return out
}

// Check runs every applicable safety rule for a prescription against the patient
// context and returns structured findings. It is pure and deterministic: the same
// inputs always yield the same result (test plan §4 determinism). Blocked is true
// iff any finding is a hard stop (contraindicated/major/allergy/species-toxic).
func Check(pc PatientContext, items []RxItem) Result {
	species := strings.ToLower(strings.TrimSpace(pc.Species))
	isAnimal := species != "" && species != "human"

	var res Result
	add := func(f Finding) {
		if f.HardStop {
			res.Blocked = true
		}
		res.Findings = append(res.Findings, f)
	}

	for _, it := range items {
		drug := normDrug(it.DrugName)
		if drug == "" {
			continue
		}

		// 1. Veterinary: species-toxicity and human-only-drug blocks (VT-003/004).
		if isAnimal {
			if speciesToxicFor(species, drug) {
				add(Finding{Kind: KindSpeciesToxic, Severity: SeverityContraindicated, Drug: it.DrugName,
					Against: species, HardStop: true,
					Message: fmt.Sprintf("%s is toxic to %ss and must not be prescribed.", it.DrugName, species)})
			} else if humanOnlyForPets[drug] {
				add(Finding{Kind: KindHumanOnly, Severity: SeverityMajor, Drug: it.DrugName,
					Against: species, HardStop: true,
					Message: fmt.Sprintf("%s is a human-only medicine and is blocked for %ss.", it.DrugName, species)})
			}
		}

		// 2. Drug–allergy (RX-002): direct name or cross-class match → hard stop.
		for _, al := range pc.Allergies {
			if a := allergyMatch(al, drug); a != "" {
				add(Finding{Kind: KindAllergy, Severity: SeverityContraindicated, Drug: it.DrugName,
					Against: a, HardStop: true,
					Message: fmt.Sprintf("Patient has a documented %s allergy; %s is contraindicated.", a, it.DrugName)})
			}
		}

		// 3. Drug–drug interaction (RX-003) against current meds.
		for _, med := range pc.CurrentMeds {
			if rule, ok := interactionBetween(drug, med); ok {
				add(Finding{Kind: KindInteraction, Severity: rule.severity, Drug: it.DrugName,
					Against: strings.TrimSpace(med), HardStop: isHardSeverity(rule.severity),
					Message: rule.message})
			}
		}

		// 4. Duplicate therapy (RX-005): same duplicable class already active.
		if cls := classOf(drug); cls != "" && duplicableClasses[cls] {
			for _, med := range pc.CurrentMeds {
				if classOf(med) == cls {
					add(Finding{Kind: KindDuplicate, Severity: SeverityModerate, Drug: it.DrugName,
						Against: strings.TrimSpace(med), HardStop: false,
						Message: fmt.Sprintf("Duplicate therapy: %s and %s are both %s.", it.DrugName, strings.TrimSpace(med), cls)})
					break
				}
			}
		}

		// 5. Dose-range / weight-based dosing (RX-004).
		if it.DoseMg > 0 {
			if lim, ok := doseLimits[drug]; ok {
				if lim.MaxSingleMg > 0 && it.DoseMg > lim.MaxSingleMg {
					add(Finding{Kind: KindDose, Severity: SeverityMajor, Drug: it.DrugName, HardStop: true,
						Message: fmt.Sprintf("Dose %.0fmg exceeds the maximum single dose of %.0fmg.", it.DoseMg, lim.MaxSingleMg)})
				} else if pc.WeightKg > 0 && lim.MaxMgPerKg > 0 && it.DoseMg > pc.WeightKg*lim.MaxMgPerKg {
					add(Finding{Kind: KindDose, Severity: SeverityMajor, Drug: it.DrugName, HardStop: true,
						Against: fmt.Sprintf("%.0fkg", pc.WeightKg),
						Message: fmt.Sprintf("Dose %.0fmg exceeds the weight-based cap of %.0fmg (%.0f mg/kg × %.0fkg).", it.DoseMg, pc.WeightKg*lim.MaxMgPerKg, lim.MaxMgPerKg, pc.WeightKg)})
				}
			}
		}
	}
	return res
}

func isHardSeverity(s Severity) bool { return s == SeverityContraindicated || s == SeverityMajor }

func speciesToxicFor(species, drug string) bool {
	set := speciesToxic[species]
	if set == nil {
		return false
	}
	if set[drug] {
		return true
	}
	if c := classOf(drug); c != "" && set[c] {
		return true
	}
	return false
}

// allergyMatch returns the matched allergy label if `allergy` implicates `drug`
// (by direct name or by cross-reacting class), else "".
func allergyMatch(allergy, drug string) string {
	a := strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(allergy))), " ")
	if a == "" {
		return ""
	}
	if normDrug(a) == drug { // direct drug-name allergy
		return allergy
	}
	cls := classOf(drug)
	if cls != "" {
		if a == cls {
			return allergy
		}
		if allergyAlias[a] == cls {
			return allergy
		}
	}
	return ""
}

// interactionBetween returns the interaction rule between two drugs, matching on
// the {name, class} token sets of each (unordered).
func interactionBetween(drugA, medB string) (interactionRule, bool) {
	ta, tb := tokensOf(drugA), tokensOf(medB)
	for _, r := range interactionRules {
		if (slices.Contains(ta, r.a) && slices.Contains(tb, r.b)) || (slices.Contains(ta, r.b) && slices.Contains(tb, r.a)) {
			return r, true
		}
	}
	return interactionRule{}, false
}

// ParseTerms coerces a loosely-typed profile field (allergies / current meds are
// stored as free text, a delimited string, or a JSON array) into a clean term
// slice for the PatientContext. It splits on commas, semicolons, and newlines,
// trims, and drops empties and "none"-style sentinels.
func ParseTerms(v any) []string {
	var raw []string
	switch t := v.(type) {
	case nil:
		return nil
	case string:
		raw = splitDelimited(t)
	case []string:
		raw = t
	case []any:
		for _, e := range t {
			if s, ok := e.(string); ok {
				raw = append(raw, splitDelimited(s)...)
			}
		}
	default:
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(raw))
	for _, r := range raw {
		s := strings.TrimSpace(r)
		low := strings.ToLower(s)
		if s == "" || low == "none" || low == "nil" || low == "n/a" || low == "no known allergies" || low == "nka" {
			continue
		}
		if seen[low] {
			continue
		}
		seen[low] = true
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func splitDelimited(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '|'
	})
}

// This file is the curated golden knowledge base — the replaceable seam. Every
// map is keyed by a normalized (lower-cased, single-spaced) drug or class token.
// A production build swaps these tables for a licensed drug-database adapter; the
// engine logic in engine.go is unchanged.

// drugSynonym normalizes trade/alt names to a canonical generic name.
var drugSynonym = map[string]string{
	"acetaminophen":        keyParacetamol,
	"tylenol":              keyParacetamol,
	"asa":                  keyAspirin,
	"acetylsalicylic acid": keyAspirin,
	"glyceryl trinitrate":  keyNitroglycerin,
	"gtn":                  keyNitroglycerin,
}

// drugClass maps a canonical drug name to its therapeutic/allergy class.
var drugClass = map[string]string{
	"amoxicillin":            keyPenicillin,
	"ampicillin":             keyPenicillin,
	keyPenicillin:            keyPenicillin,
	"flucloxacillin":         keyPenicillin,
	"azithromycin":           keyMacrolide,
	"erythromycin":           keyMacrolide,
	"clarithromycin":         keyMacrolide,
	keyIbuprofen:             "nsaid",
	"naproxen":               "nsaid",
	"diclofenac":             "nsaid",
	keyAspirin:               "nsaid",
	keyParacetamol:           "analgesic_apap",
	"warfarin":               keyAnticoagulant,
	"sildenafil":             keyPde5,
	"tadalafil":              keyPde5,
	"isosorbide dinitrate":   keyNitrate,
	"isosorbide mononitrate": keyNitrate,
	keyNitroglycerin:         keyNitrate,
	"lisinopril":             keyAcei,
	"ramipril":               keyAcei,
	"enalapril":              keyAcei,
	"sertraline":             keySsri,
	"fluoxetine":             keySsri,
	"citalopram":             keySsri,
	"loratadine":             "antihistamine",
	"cetirizine":             "antihistamine",
	"sulfamethoxazole":       keySulfonamide,
	"metformin":              "biguanide",
}

// allergyAlias maps a free-text allergy term to the drug class it implicates, so
// "penicillin"/"sulfa" etc. cross-react with every drug in that class.
var allergyAlias = map[string]string{
	keyPenicillin:  keyPenicillin,
	"penicillins":  keyPenicillin,
	"sulfa":        keySulfonamide,
	"sulfur":       keySulfonamide,
	"sulphonamide": keySulfonamide,
	keySulfonamide: keySulfonamide,
	"nsaid":        "nsaid",
	"nsaids":       "nsaid",
	keyAspirin:     "nsaid",
	keyMacrolide:   keyMacrolide,
}

// interactionRule is an unordered pair of tokens (drug names or classes) with a
// severity. Tokens are matched against each drug's {name, class} token set.
type interactionRule struct {
	a, b     string
	severity Severity
	message  string
}

var interactionRules = []interactionRule{
	{keyAnticoagulant, "nsaid", SeverityMajor, "Increased bleeding risk (anticoagulant + NSAID)."},
	{keyAnticoagulant, keyAspirin, SeverityMajor, "Increased bleeding risk (anticoagulant + aspirin)."},
	{keyNitrate, keyPde5, SeverityContraindicated, "Life-threatening hypotension (nitrate + PDE5 inhibitor)."},
	{keySsri, "maoi", SeverityContraindicated, "Serotonin syndrome risk (SSRI + MAOI)."},
	{keyAcei, "potassium", SeverityModerate, "Hyperkalemia risk (ACE inhibitor + potassium)."},
	{keyMacrolide, "warfarin", SeverityMajor, "Macrolides potentiate warfarin (bleeding risk)."},
	{keyPde5, keyNitrate, SeverityContraindicated, "Life-threatening hypotension (PDE5 inhibitor + nitrate)."},
}

// doseLimit caps a drug's single dose. MaxSingleMg is the adult single-dose cap;
// MaxMgPerKg is the per-dose weight-based cap applied whenever weight is known.
type doseLimit struct {
	MaxSingleMg float64
	MaxMgPerKg  float64
}

var doseLimits = map[string]doseLimit{
	keyParacetamol: {MaxSingleMg: 1000, MaxMgPerKg: 15},
	keyIbuprofen:   {MaxSingleMg: 800, MaxMgPerKg: 10},
	"amoxicillin":  {MaxSingleMg: 1000, MaxMgPerKg: 30},
}

// duplicableClasses are therapeutic classes where two concurrent agents is a
// duplicate-therapy concern (surfaced, not hard-stopped).
var duplicableClasses = map[string]bool{
	"nsaid": true, keySsri: true, keyAcei: true, keyAnticoagulant: true, keyPde5: true,
}

// speciesToxic lists substances (drug name or class token) toxic to a species —
// a hard block for that species.
var speciesToxic = map[string]map[string]bool{
	"cat": {keyParacetamol: true, "analgesic_apap": true, keyAspirin: true, keyIbuprofen: true, "nsaid": true, "xylitol": true, "permethrin": true},
	"dog": {"xylitol": true, keyIbuprofen: true, "grapes": true, "chocolate": true, "theobromine": true},
}

// humanOnlyForPets are human medicines blocked for any non-human species by
// policy unless a licensed vet records an override.
var humanOnlyForPets = map[string]bool{
	keyIbuprofen: true, "naproxen": true, "diclofenac": true, keyParacetamol: true,
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
