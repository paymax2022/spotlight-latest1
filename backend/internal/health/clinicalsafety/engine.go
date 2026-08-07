package clinicalsafety

import (
	"fmt"
	"strings"
)

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
		if (containsTok(ta, r.a) && containsTok(tb, r.b)) || (containsTok(ta, r.b) && containsTok(tb, r.a)) {
			return r, true
		}
	}
	return interactionRule{}, false
}

func containsTok(toks []string, want string) bool {
	for _, t := range toks {
		if t == want {
			return true
		}
	}
	return false
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
