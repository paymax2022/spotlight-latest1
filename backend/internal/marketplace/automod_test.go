package marketplace

import "testing"

func TestScreenListingContent(t *testing.T) {
	cases := []struct {
		name        string
		title       string
		desc        string
		attrs       map[string]any
		wantFlagged bool
	}{
		{"clean listing", "Clean Toyota Corolla 2015", "well maintained first body accident free lagos pickup", nil, false},
		{"weapon in title", "AK47 for sale cheap", "brand new in box available now lagos delivery", nil, true},
		{"weapon hyphenated", "AK-47 available", "brand new in box available now lagos delivery today", nil, true},
		{"drug in description", "Herbal supplement pack", "contains cocaine and other imported herbs for energy boost", nil, true},
		{"escrow evasion phrase", "iPhone 15 Pro Max", "great phone please pay outside the platform for a discount today", nil, true},
		{"counterfeit", "Designer wallet", "premium cloned card holder leather finish top quality lagos", nil, true},
		{"flagged term inside a longer word is NOT matched", "Meghan collectible plate", "beautiful ceramic display piece for your living room shelf lagos", nil, false},
		{"prohibited term in a string attr", "Collectible item", "rare vintage piece in excellent condition for serious collectors", map[string]any{"note": "comes with free ammunition"}, true},
		{"non-string attrs ignored", "Toyota Corolla", "well maintained first body accident free lagos pickup available", map[string]any{"year": 2015, "negotiable": true}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := screenListingContent(c.title, c.desc, c.attrs)
			if (got != "") != c.wantFlagged {
				t.Fatalf("screenListingContent()=%q, wantFlagged=%v", got, c.wantFlagged)
			}
		})
	}
}

// "gun" must not match "began"/"begun"; word boundaries are load-bearing.
func TestScreenText_WordBoundary(t *testing.T) {
	for _, s := range []string{"the sale has begun", "a bargain deal", "handgunning is not a word here"} {
		if r := screenText(s); r != "" {
			t.Errorf("screenText(%q) falsely flagged as %q", s, r)
		}
	}
}
