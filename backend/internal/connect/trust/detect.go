package connecttrust

import (
	"sort"
	"strings"
)

// Category buckets a detection into the scam-shield/case taxonomy.
type Category string

const (
	CategoryFinancial     Category = "financial_solicitation"
	CategoryOffPlatform   Category = "off_platform"
	CategoryHarassment    Category = "harassment"
	CategoryImpersonation Category = "impersonation"
)

// Detection is the result of scanning one message body against the backend-owned
// trigger-term lists. It is deterministic and pure (no DB, no LLM) so it is cheap
// to run inline on every message send and trivial to unit-test.
type Detection struct {
	Flagged     bool       // any category matched
	Categories  []Category // distinct categories that matched (sorted, stable)
	ReasonCodes []string   // machine reason codes stored with the flag (sorted)
	Score       int        // weighted severity; financial/harassment weigh heavier
	Warning     string     // user-facing inline warning (safe, non-shaming)
}

// reason-code prefixes keep stored codes structured + greppable for moderators.
const (
	rcFinancial   = "scam.financial"
	rcOffPlatform = "scam.off_platform"
	rcHarassment  = "abuse.harassment"
)

// per-category severity weights. Centralised so scoring stays consistent; the
// escalation/case THRESHOLDS these scores are compared against come from config.
var categoryWeight = map[Category]int{
	CategoryFinancial:   3,
	CategoryHarassment:  3,
	CategoryOffPlatform: 1,
}

// Scan inspects body against the loaded thresholds and returns a Detection. It
// matches case-insensitively on whole substrings (terms are curated phrases).
// No part of body is logged or returned in the Detection (PII-safe by design).
func Scan(body string, t Thresholds) Detection {
	lc := strings.ToLower(body)
	catSet := map[Category]bool{}
	codeSet := map[string]bool{}

	scan := func(terms []string, cat Category, codePrefix string) {
		for _, term := range terms {
			term = strings.TrimSpace(strings.ToLower(term))
			if term == "" {
				continue
			}
			if strings.Contains(lc, term) {
				catSet[cat] = true
				codeSet[codePrefix+":"+slug(term)] = true
			}
		}
	}

	scan(t.FinancialTerms, CategoryFinancial, rcFinancial)
	scan(t.OffPlatformTerms, CategoryOffPlatform, rcOffPlatform)
	scan(t.HarassmentTerms, CategoryHarassment, rcHarassment)

	if len(catSet) == 0 {
		return Detection{}
	}

	d := Detection{Flagged: true}
	for cat := range catSet {
		d.Categories = append(d.Categories, cat)
		d.Score += categoryWeight[cat]
	}
	for code := range codeSet {
		d.ReasonCodes = append(d.ReasonCodes, code)
	}
	sortCategories(d.Categories)
	sort.Strings(d.ReasonCodes)
	d.Warning = warningFor(d.Categories)
	return d
}

// PrimaryCategory returns the highest-weight category for storing on a single
// scam-shield flag row. Empty when nothing flagged.
func (d Detection) PrimaryCategory() Category {
	var best Category
	bestW := -1
	for _, c := range d.Categories {
		if categoryWeight[c] > bestW {
			best, bestW = c, categoryWeight[c]
		}
	}
	return best
}

// warningFor composes a single safe, supportive inline warning. Warnings never
// shame the user and surface platform-safety guidance (compliance sensitive-topic note).
func warningFor(cats []Category) string {
	has := func(c Category) bool {
		for _, x := range cats {
			if x == c {
				return true
			}
		}
		return false
	}
	switch {
	case has(CategoryFinancial):
		return "Heads up: requests to send money, gift cards, or crypto are a common scam tactic. Never send funds to someone you met here. Keep payments on Paymax."
	case has(CategoryHarassment):
		return "This message may violate our community guidelines on respectful conduct. You can report or block this person at any time, and support resources are available."
	case has(CategoryOffPlatform):
		return "For your safety, keep conversations on Paymax Connect until you trust each other. Moving to other apps removes our safety protections."
	default:
		return "This message was flagged by our safety system. Stay alert and report anything that feels off."
	}
}

func slug(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.ReplaceAll(s, " ", "_")
	return s
}

func sortCategories(cs []Category) {
	sort.Slice(cs, func(i, j int) bool { return cs[i] < cs[j] })
}
