package namematch

import "testing"

func TestMatch(t *testing.T) {
	cases := []struct {
		name       string
		account    string
		candidates []string
		want       Outcome
	}{
		// Same person, the way banks actually print names.
		{"exact", "JOHN ADEWALE SMITH", []string{"John Adewale Smith"}, Matched},
		{"any order, surname first", "SMITH JOHN ADEWALE", []string{"John Adewale Smith"}, Matched},
		{"middle name missing on the account", "JOHN SMITH", []string{"John Adewale Smith"}, Matched},
		{"middle initial", "SMITH JOHN A", []string{"John Adewale Smith"}, Matched},
		{"bank truncation", "OKONKWO-NWACHUKWU CHIDI", []string{"Chidinma Okonkwo-Nwachukwu"}, Matched},
		{"punctuation and spacing", "  smith,  john.  ", []string{"JOHN SMITH"}, Matched},
		{"title stripped", "MR JOHN SMITH", []string{"John Smith"}, Matched},
		{"religious/honorific title stripped", "ALHAJI MUSA BELLO", []string{"Musa Bello"}, Matched},

		// Business accounts against a legal name.
		{"business with legal suffix", "MAMA PUT KITCHEN LTD", []string{"Mama Put Kitchen Limited"}, Matched},
		{"business, second candidate wins", "MAMA PUT KITCHEN", []string{"Ada Obi", "Mama Put Kitchen"}, Matched},

		// Plausible but not certain: a person must look.
		{"only initial + surname", "J SMITH", []string{"John Smith"}, Partial},
		{"married surname differs", "MARY OKAFOR", []string{"Mary Adebayo"}, Partial},
		{"extra unknown token", "JOHN SMITH TRADING", []string{"John Smith"}, Partial},

		// Someone else's account.
		{"different person", "PETER OBI", []string{"John Smith"}, Mismatch},
		{"initial alone is not identity", "J OKAFOR", []string{"John Smith"}, Mismatch},
		{"no candidates", "JOHN SMITH", nil, Mismatch},

		// Security review probes: none of these may be Matched.
		{"verified name is not a truncation of the account", "ADEBAYO OBINNA", []string{"Ade Obi"}, Mismatch},
		{"longer names that only share prefixes", "JOHN SMITH", []string{"Johnathan Smithson"}, Partial},
		{"truncated surname is not enough on its own", "JOHN SMITH", []string{"John Smithson"}, Partial},
		{"stuffed candidate name", "PETER OBI", []string{"Peter Paul Obi Musa Bello John Smith Ade Kitchen"}, Partial},
		{"a single exact token of a long name", "MUSA BELLO", []string{"Peter Paul Obi Musa Bello John Smith Ade Kitchen"}, Partial},
		{"empty account name", "", []string{"John Smith"}, Mismatch},
		{"title only", "MR", []string{"Mr"}, Mismatch},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Match(tc.account, tc.candidates...)
			if got.Outcome != tc.want {
				t.Fatalf("Match(%q, %q) = %s (score %d, %s), want %s", tc.account, tc.candidates, got.Outcome, got.Score, got.Reason, tc.want)
			}
			if got.Score < 0 || got.Score > 100 {
				t.Fatalf("score %d out of range", got.Score)
			}
		})
	}
}

func TestMatch_ScoreOrdersOutcomes(t *testing.T) {
	m := Match("JOHN SMITH", "John Smith")
	p := Match("MARY OKAFOR", "Mary Adebayo")
	x := Match("PETER OBI", "John Smith")
	if !(m.Score > p.Score && p.Score > x.Score) {
		t.Fatalf("scores not ordered: match %d, partial %d, mismatch %d", m.Score, p.Score, x.Score)
	}
}

// A shorter, truncated token only counts when it is long enough to be a real
// prefix; two letters could be anyone.
func TestMatch_ShortPrefixIsNotATruncation(t *testing.T) {
	if got := Match("JO SMITH", "John Smith"); got.Outcome == Matched {
		t.Fatalf("two-letter prefix matched as a full name: %+v", got)
	}
}
