package catalog

import "testing"

// TestFamilyMap_EmbeddedDataIsWellFormed catches a bad edit to
// mycover_families.json at build time rather than at a member's purchase.
func TestFamilyMap_EmbeddedDataIsWellFormed(t *testing.T) {
	m := LoadFamilyMap("")
	if m.Len() == 0 {
		t.Fatal("embedded family map is empty")
	}
	if problems := m.Validate(); len(problems) > 0 {
		t.Fatalf("family map has structural problems: %v", problems)
	}
}

// TestFamilyMap_OnlyVerifiedFamiliesAreHandedOut is the safety invariant.
//
// A family whose path merely EXISTS (probe returned non-404) but whose schema
// was never harvested must NOT be usable for binding: the bind would fail
// validation after the member had already been debited. Same for the two Life
// families that answer 403 for our key.
func TestFamilyMap_OnlyVerifiedFamiliesAreHandedOut(t *testing.T) {
	m := LoadFamilyMap("")
	for _, f := range m.Families() {
		if !f.PathVerified {
			continue
		}
		if len(f.FormSchema) == 0 {
			t.Fatalf("family %q is marked verified but has no form schema — bind would fail after the debit", f.Family)
		}
	}

	// The scope-blocked Life families must never be handed out.
	for _, code := range []string{"sanlam-comprehensive", "tangerine-life-plan"} {
		if path, _, ok := m.SchemaFor(code, "sanlam", "Life"); ok {
			t.Fatalf("403 scope-blocked family handed out for %q: %s", code, path)
		}
	}
}

func TestFamilyMap_ResolvesByPrefixAndCategory(t *testing.T) {
	m := LoadFamilyMap("")

	path, schema, ok := m.SchemaFor("bastion-flexicare-mini", "bastion", "Health")
	if !ok {
		t.Fatal("a Bastion health product must resolve to the verified health family")
	}
	if path != "/products/bastion/buy-medisure" {
		t.Fatalf("buy path = %q", path)
	}
	if len(schema) == 0 {
		t.Fatal("a verified family must carry its schema")
	}

	// Category is part of the match: a Bastion product in another category must
	// not be silently sold through the health endpoint.
	if _, _, ok := m.SchemaFor("bastion-something", "bastion", "Auto"); ok {
		t.Fatal("category mismatch must not resolve — that would sell the wrong cover")
	}

	// An unknown product gets nothing, so bind fails closed.
	if _, _, ok := m.SchemaFor("totally-unknown", "nosuch", "Health"); ok {
		t.Fatal("an unmapped product must not resolve to any family")
	}
}

// TestLoadFamilyMap_BadOverrideFallsBackToEmbedded — a broken override file must
// not strip every product of its buy path and take the module offline.
func TestLoadFamilyMap_BadOverrideFallsBackToEmbedded(t *testing.T) {
	m := LoadFamilyMap("/nonexistent/path/families.json")
	if m.Len() == 0 {
		t.Fatal("an unreadable override must fall back to the built-in map")
	}
}

func TestProductLineFor_MapsEveryLiveCategory(t *testing.T) {
	// The seven categories present in the live 68-product catalog.
	want := map[string]string{
		"Life": "life", "Auto": "auto", "Health": "health", "Content": "content",
		"Gadget": "gadget", "Package": "package", "Travel": "travel",
	}
	for in, exp := range want {
		if got := productLineFor(in); got != exp {
			t.Fatalf("productLineFor(%q) = %q, want %q", in, got, exp)
		}
	}
	// An unknown category must land as "other", never be dropped: an invisible
	// product is worse than an uncategorised one.
	if got := productLineFor("Pet Insurance"); got != "other" {
		t.Fatalf("unknown category = %q, want other", got)
	}
}

func TestFamilySegment(t *testing.T) {
	if got := familySegment("/products/bastion/buy-medisure"); got != "bastion" {
		t.Fatalf("familySegment = %q", got)
	}
	if got := familySegment("nonsense"); got != "" {
		t.Fatalf("familySegment(nonsense) = %q", got)
	}
}

func TestPercentStringToBps(t *testing.T) {
	// sharing_formula states WHOLE percents; 10% is 1000 bps.
	if got := percentStringToBps("10"); got != 1000 {
		t.Fatalf("10%% = %d bps, want 1000", got)
	}
	if got := percentStringToBps("12.5"); got != 1250 {
		t.Fatalf("12.5%% = %d bps, want 1250", got)
	}
	// A commission figure is revenue — never guessed.
	if got := percentStringToBps("garbage"); got != 0 {
		t.Fatalf("unparseable commission = %d, want 0", got)
	}
	if got := percentStringToBps(""); got != 0 {
		t.Fatalf("empty commission = %d, want 0", got)
	}
}
