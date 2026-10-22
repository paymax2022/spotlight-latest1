// Package namematch compares the holder name a bank returns for an account
// (name enquiry) with the name a person or business was verified under.
//
// It is deliberately conservative: Matched means "safe to trust without a
// human", and anything plausible-but-uncertain is Partial so a person can look.
// It understands how Nigerian bank names are actually printed:
//   - case, punctuation, hyphens and spacing are ignored;
//   - name parts can come in any order (banks often put the surname first);
//   - a middle name can be missing, or reduced to an initial;
//   - a bank can truncate a long name part (CHIDI for CHIDINMA), never the
//     other way round;
//   - titles (MR, ALHAJI, DR…) and company suffixes (LTD, LIMITED, PLC…) carry
//     no identity.
//
// It never accepts a match on initials or truncations alone, and a two-letter
// prefix is not a truncation, so it never says Matched on fuzzy similarity.
// Accented letters are not folded: Adébáyọ̀ vs ADEBAYO is a Mismatch, which
// only sends the account to review.
package namematch

import (
	"math"
	"strings"
	"unicode"
)

// Outcome is the verdict for one account name.
type Outcome string

const (
	Matched  Outcome = "matched"  // every part of the account name belongs to the verified name
	Partial  Outcome = "partial"  // shares a real name part but not all of it — needs a person
	Mismatch Outcome = "mismatch" // shares no real name part — someone else's account
)

// Result is the verdict plus a 0–100 score and a short reason for audit logs.
// The reason never contains the names themselves.
type Result struct {
	Outcome Outcome
	Score   int
	Reason  string
}

// minPrefixLen is the shortest name part accepted as a bank truncation of a
// longer one. Two letters (JO) could be anyone.
const minPrefixLen = 3

// noise words carry no identity: personal titles and company legal suffixes.
var noise = map[string]bool{
	"MR": true, "MRS": true, "MS": true, "MISS": true, "MASTER": true, "DR": true, "PROF": true,
	"ENGR": true, "ENG": true, "ARC": true, "BARR": true, "HON": true, "CHIEF": true, "SIR": true,
	"ALHAJI": true, "ALHAJA": true, "ALH": true, "HAJIA": true, "HAJI": true, "PASTOR": true,
	"REV": true, "EVANG": true, "PRINCE": true, "PRINCESS": true, "OBA": true, "DCN": true,
	"LTD": true, "LIMITED": true, "PLC": true, "INC": true, "CO": true, "COMPANY": true,
	"NIG": true, "NIGERIA": true, "RC": true, "BN": true,
}

// Match compares accountName with each candidate verified name and returns the
// best verdict. With no usable candidate it is a Mismatch.
func Match(accountName string, candidates ...string) Result {
	acct := tokens(accountName)
	if len(acct) == 0 {
		return Result{Outcome: Mismatch, Reason: "account name has no name parts"}
	}
	best := Result{Outcome: Mismatch, Reason: "no verified name to compare"}
	for _, c := range candidates {
		cand := tokens(c)
		if len(cand) == 0 {
			continue
		}
		if r := compare(acct, cand); better(r, best) {
			best = r
		}
	}
	return best
}

func better(a, b Result) bool {
	rank := map[Outcome]int{Mismatch: 0, Partial: 1, Matched: 2}
	if rank[a.Outcome] != rank[b.Outcome] {
		return rank[a.Outcome] > rank[b.Outcome]
	}
	return a.Score > b.Score
}

// compare pairs each account name part with at most one verified name part:
// exact matches first, then truncations, then initials.
//
// Matched needs all of:
//   - every account name part belongs to the verified name;
//   - at least min(2, parts in the verified name) EXACT parts — a truncation
//     only ever adds to that (SMITH could be a different, longer SMITHSON);
//   - at least half of the verified name used, so an account cannot match a
//     long "stuffed" name by borrowing two of its parts.
//
// Truncation only goes one way: the bank shortens the ACCOUNT name, never the
// verified one, so ADEBAYO does not match a verified ADE.
func compare(acct, cand []string) Result {
	used := make([]bool, len(cand))
	matched := make([]bool, len(acct))
	exact, prefix, initials := 0, 0, 0

	pass := func(ok func(a, c string) bool, count *int) {
		for i, a := range acct {
			if matched[i] {
				continue
			}
			for j, c := range cand {
				if used[j] || !ok(a, c) {
					continue
				}
				used[j], matched[i] = true, true
				*count++
				break
			}
		}
	}
	pass(func(a, c string) bool { return len(a) >= 2 && a == c }, &exact)
	pass(func(a, c string) bool {
		return len(a) >= minPrefixLen && len(a) < len(c) && strings.HasPrefix(c, a)
	}, &prefix)
	pass(func(a, c string) bool { return len(a) == 1 && a[0] == c[0] }, &initials)

	allMatched := true
	for _, m := range matched {
		allMatched = allMatched && m
	}
	usedCand := 0
	for _, u := range used {
		if u {
			usedCand++
		}
	}
	full := exact + prefix
	score := int(math.Round(100 * (2*float64(exact) + 1.5*float64(prefix) + float64(initials)) / float64(len(acct)+len(cand))))
	if score > 100 {
		score = 100
	}

	need := min(2, len(cand)) // full name parts needed for a confident match
	switch {
	case allMatched && exact >= need && 2*usedCand >= len(cand):
		return Result{Outcome: Matched, Score: score, Reason: "every account name part belongs to the verified name"}
	case full >= 1:
		return Result{Outcome: Partial, Score: score, Reason: "shares a name part but not the whole name"}
	default:
		return Result{Outcome: Mismatch, Score: score, Reason: "shares no full name part with the verified name"}
	}
}

// tokens upper-cases a name, splits it on anything that is not a letter or
// digit, and drops titles and company suffixes.
func tokens(s string) []string {
	parts := strings.FieldsFunc(strings.ToUpper(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	out := parts[:0]
	for _, p := range parts {
		if !noise[p] {
			out = append(out, p)
		}
	}
	return out
}
