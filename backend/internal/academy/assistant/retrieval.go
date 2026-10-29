package assistant

// retrieval.go — V1 knowledge retrieval: ranked keyword matching over published
// FAQs, with no vector store.
//
// The collection is a dozen curated entries, so an embedding index would add a
// dependency, a backfill and a stale-vector failure mode without improving
// precision over term matching. The scoring below deliberately weights the FAQ
// question and its keywords well above incidental answer text: an answer that
// merely mentions "fee" should not outrank the entry whose question IS about
// fees.
//
// The risky categories — money, dates, entry rules, address — are handled by an
// exact-category gate rather than by score. A near-miss answer about hostel
// charges is not a partial answer about tuition; it is a wrong number attached to
// a confident sentence. If the best published entry is not in the same category
// the question is clearly about, retrieval returns nothing and the student gets
// the honest fallback plus a human.

import (
	"sort"
	"strings"
	"unicode/utf8"
)

// MaxContextFaqs caps how many entries are sent upstream. Three is enough to
// answer a question and small enough that a mistaken fourth cannot quietly
// contradict the first.
const MaxContextFaqs = 3

// minRelevance is the floor a candidate must clear to be sent to the model at
// all. It is calibrated against the seeded collection: a single shared
// content-word is not evidence, and this is the value that makes "no reliable
// match" a real state rather than a formality.
const minRelevance = 3.0

// minQuestionTokens rejects a turn too short to carry intent. One or two letters
// is a tap, not a question, and matching it to a random FAQ is how an assistant
// starts sounding unreliable.
const minQuestionTokens = 2

// stopWords are the common English connectives stripped before matching. Kept
// short and lowercase; anything that carries academy meaning ("no", "not")
// stays, because "will I get a certificate" loses its point without them.
var stopWords = map[string]bool{
	"a": true, "an": true, "the": true, "is": true, "are": true, "was": true, "were": true,
	"do": true, "does": true, "did": true, "have": true, "has": true, "had": true,
	"i": true, "me": true, "my": true, "we": true, "our": true, "you": true, "your": true,
	"it": true, "its": true, "this": true, "that": true, "these": true, "those": true,
	"of": true, "on": true, "in": true, "at": true, "to": true, "for": true, "with": true,
	"and": true, "or": true, "but": true, "so": true, "as": true, "if": true,
	"can": true, "could": true, "would": true, "should": true, "will": true, "shall": true,
	"be": true, "been": true, "being": true, "am": true, "about": true, "from": true,
	"how": true, "what": true, "when": true, "where": true, "who": true, "which": true, "why": true,
	"please": true, "hello": true, "hi": true, "hey": true, "thanks": true,
}

// riskyCategories need an exact-category hit; a strong term match from another
// category is refused. These are the four the spec names, and the four where a
// wrong figure or date is the most costly mistake the assistant can make.
var riskyCategories = map[string]bool{
	"fees": true, "dates": true, "eligibility": true, "location": true, "payments": true,
}

// categoryHints maps surface words to the seeded category slugs, so the
// exact-category gate can tell that "how much is school" is a fees question even
// though the student never wrote the word "fees".
var categoryHints = map[string][]string{
	"fees":         {"fee", "fees", "tuition", "price", "cost", "expensive", "money", "charge", "charges", "ngn", "naira"},
	"payments":     {"instalment", "installment", "instalments", "installments", "pay", "payment", "refund"},
	"dates":        {"intake", "deadline", "start", "begins", "commence", "cohort", "batch", "next", "date", "when", "time"},
	"eligibility":  {"requirement", "requirements", "eligibility", "eligible", "age", "entry", "qualification", "documents", "admission", "admissions"},
	"location":     {"location", "address", "where", "directions", "map", "situated", "office"},
	"registration": {"register", "registration", "signup", "sign", "apply", "application", "enrol", "enroll", "enrollment", "enrolment"},
	"courses":      {"course", "courses", "subject", "subjects", "curriculum", "training", "learn", "syllabus", "area", "areas"},
	"production":   {"movie", "film", "project", "projects", "production", "shoot", "casting", "set"},
	"facilities":   {"hostel", "boarding", "accommodation", "stay", "residence", "facilities", "facility"},
	"certificate":  {"certificate", "certification", "diploma", "graduation", "completion"},
	"career":       {"role", "roles", "job", "jobs", "career", "employment", "work", "contract", "talent", "management"},
	"support":      {"contact", "support", "call", "phone", "email", "reach", "help"},
}

// normalize lowercases, drops punctuation and splits into content-word tokens.
func normalize(s string) []string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == ' ' || r == '\'' {
			b.WriteRune(r)
			continue
		}
		b.WriteRune(' ')
	}
	fields := strings.Fields(b.String())
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		f = strings.Trim(f, "'")
		if f == "" || stopWords[f] || utf8.RuneCountInString(f) < 2 {
			continue
		}
		out = append(out, f)
	}
	return out
}

// detectCategory scores each category's hint words against the tokens and
// returns the strongest, or "" when the question matches no category hint. The
// exact-category gate only applies when this returns a risky one.
func detectCategory(tokens []string) string {
	if len(tokens) == 0 {
		return ""
	}
	best, bestScore := "", 0
	for category, hints := range categoryHints {
		score := 0
		for _, tok := range tokens {
			for _, hint := range hints {
				if tok == hint || strings.HasPrefix(tok, hint) {
					score++
					break
				}
			}
		}
		if score > bestScore {
			best, bestScore = category, score
		}
	}
	if bestScore == 0 {
		return ""
	}
	return best
}

// scoreCandidate weights the places a term may appear: an explicit keyword or a
// question match is evidence, answer text is context.
func scoreCandidate(f Faq, tokens []string) float64 {
	if len(tokens) == 0 {
		return 0
	}
	score := 0.0
	keywordSet := make(map[string]bool, len(f.Keywords))
	for _, k := range f.Keywords {
		for _, tok := range normalize(k) {
			keywordSet[tok] = true
		}
	}
	questionSet := make(map[string]bool)
	for _, tok := range normalize(f.Question) {
		questionSet[tok] = true
	}
	categorySet := make(map[string]bool)
	for _, tok := range normalize(f.Category) {
		categorySet[tok] = true
	}
	answerSet := make(map[string]bool)
	for _, tok := range normalize(f.Answer) {
		answerSet[tok] = true
	}

	matched := 0
	for _, tok := range tokens {
		switch {
		case questionSet[tok]:
			score += 3
			matched++
		case keywordSet[tok]:
			score += 2.5
			matched++
		case categorySet[tok]:
			score += 2
			matched++
		case answerSet[tok]:
			score += 0.75
			matched++
		}
	}
	if matched == 0 {
		return 0
	}
	// Reward covering more of the question, so "how do i register for the film
	// academy" beats a FAQ that shares only "academy".
	coverage := float64(matched) / float64(len(tokens))
	return score * (0.6 + 0.4*coverage)
}

// retrieval is the ranked result the service acts on.
type retrieval struct {
	Faqs    []Faq
	Sources []string
	// Reason is the detected category, surfaced so the service can explain an
	// exact-category refusal in its logs without logging the question.
	Reason string
}

// rank selects the published entries that may ground an answer. It is pure and
// takes the candidate list as an argument so relevance behaviour is testable
// without a database.
//
// Returns ErrNoEvidence when nothing qualifies — including the case where the
// question is clearly about fees, dates, eligibility or location but the best
// published entry belongs to a different category.
func rank(candidates []Faq, question string) (retrieval, error) {
	tokens := normalize(question)
	detected := detectCategory(tokens)
	if len(tokens) < minQuestionTokens || len(candidates) == 0 {
		return retrieval{Reason: detected}, ErrNoEvidence
	}

	type scored struct {
		faq   Faq
		value float64
	}
	var hits []scored
	for _, f := range candidates {
		if f.DeletedAt != nil || !f.Published || hasUnapprovedPlaceholder(f.Answer) {
			continue
		}
		v := scoreCandidate(f, tokens)
		if v < minRelevance {
			continue
		}
		// The exact-category gate: a risky question may only be answered by an
		// entry in that same category.
		if riskyCategories[detected] && !strings.EqualFold(strings.TrimSpace(f.Category), detected) {
			continue
		}
		hits = append(hits, scored{faq: f, value: v})
	}
	if len(hits) == 0 {
		return retrieval{Reason: detected}, ErrNoEvidence
	}

	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].value == hits[j].value {
			return hits[i].faq.UpdatedAt.After(hits[j].faq.UpdatedAt)
		}
		return hits[i].value > hits[j].value
	})
	if len(hits) > MaxContextFaqs {
		hits = hits[:MaxContextFaqs]
	}

	out := retrieval{Reason: detected, Faqs: make([]Faq, 0, len(hits)), Sources: make([]string, 0, len(hits))}
	for _, h := range hits {
		out.Faqs = append(out.Faqs, h.faq)
		out.Sources = append(out.Sources, h.faq.ID.String())
	}
	return out, nil
}

// suggestions derives the opening chips from published entries only, so an
// unpublished topic can never appear as a suggestion.
func suggestions(candidates []Faq, limit int) []string {
	out := make([]string, 0, limit)
	seenCategory := make(map[string]bool)
	for _, f := range candidates {
		if len(out) >= limit {
			break
		}
		if f.DeletedAt != nil || !f.Published || hasUnapprovedPlaceholder(f.Answer) {
			continue
		}
		// One chip per category keeps the five suggestions covering five
		// different subjects instead of five registration variants.
		key := strings.ToLower(strings.TrimSpace(f.Category))
		if seenCategory[key] {
			continue
		}
		seenCategory[key] = true
		out = append(out, f.Question)
	}
	return out
}
