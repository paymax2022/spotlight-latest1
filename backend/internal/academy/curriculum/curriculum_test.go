package curriculum

import "testing"

// TestBindVersion exercises the pure version-binding policy: entry classes from
// the NERDC effective year (2025) onward bind to NERDC-2025; earlier cohorts (and
// classes still mid-cycle) bind to LEGACY. entryYear == 0 (unknown) defaults to
// the current curriculum, NERDC-2025.
func TestBindVersion(t *testing.T) {
	cases := []struct {
		name      string
		classCode string
		entryYear int
		want      string
	}{
		{"unknown entry year defaults to NERDC", "P1", 0, VersionCodeNERDC2025},
		{"entry class 2025 binds NERDC", "P1", 2025, VersionCodeNERDC2025},
		{"entry class P4 2025 binds NERDC", "P4", 2025, VersionCodeNERDC2025},
		{"entry class JSS1 2026 binds NERDC", "JSS1", 2026, VersionCodeNERDC2025},
		{"entry class SSS1 future binds NERDC", "SSS1", 2030, VersionCodeNERDC2025},
		{"pre-2025 cohort binds LEGACY", "P5", 2024, VersionCodeLegacy},
		{"mid-cycle 2023 binds LEGACY", "JSS2", 2023, VersionCodeLegacy},
		{"boundary year-1 binds LEGACY", "SSS2", 2024, VersionCodeLegacy},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := BindVersion(c.classCode, c.entryYear); got != c.want {
				t.Fatalf("BindVersion(%q,%d) = %q; want %q", c.classCode, c.entryYear, got, c.want)
			}
		})
	}
}

// TestBindVersionBoundary pins the exact effective-year cutover.
func TestBindVersionBoundary(t *testing.T) {
	if got := BindVersion("P1", nerdcEffectiveYear); got != VersionCodeNERDC2025 {
		t.Fatalf("at effective year want NERDC, got %q", got)
	}
	if got := BindVersion("P1", nerdcEffectiveYear-1); got != VersionCodeLegacy {
		t.Fatalf("year before effective want LEGACY, got %q", got)
	}
}

// TestClassSpineContract guards the seeded class spine: 12 classes, ascending
// distinct ordinals, and the correct phase per band (the seed feeds BOTH versions
// from this single spec).
func TestClassSpineContract(t *testing.T) {
	spine := classSpine()
	if len(spine) != 12 {
		t.Fatalf("class spine should have 12 classes, got %d", len(spine))
	}
	wantPhase := map[string]string{
		"P1": "LowerPrimary", "P2": "LowerPrimary", "P3": "LowerPrimary",
		"P4": "UpperPrimary", "P5": "UpperPrimary", "P6": "UpperPrimary",
		"JSS1": "JSS", "JSS2": "JSS", "JSS3": "JSS",
		"SSS1": "SSS", "SSS2": "SSS", "SSS3": "SSS",
	}
	seenOrd := map[int]bool{}
	lastOrd := 0
	for _, c := range spine {
		if wantPhase[c.code] != c.phase {
			t.Errorf("class %s: phase = %q, want %q", c.code, c.phase, wantPhase[c.code])
		}
		if seenOrd[c.ordinal] {
			t.Errorf("class %s: duplicate ordinal %d", c.code, c.ordinal)
		}
		seenOrd[c.ordinal] = true
		if c.ordinal <= lastOrd {
			t.Errorf("class %s: ordinal %d not ascending (prev %d)", c.code, c.ordinal, lastOrd)
		}
		lastOrd = c.ordinal
	}
}

// TestEntryClassTreeContract verifies the seed-data shape required by curriculum.md:
//   - exactly the four NERDC-2025 entry classes carry content trees;
//   - 3-5 subjects per class, each with 1-2 topics and each topic 1-3 objectives;
//   - exam_relevance tags follow the phase rule (P4→CCE, JSS1→BECE, SSS1→WASSCE/NECO/UTME);
//   - P1 (Lower Primary, no terminal exam) carries no exam tags.
//
// This is the idempotency/insert contract that Seed's ON CONFLICT DO NOTHING relies
// on: every node has a stable natural key (subject.code / topic.code / objective.code)
// unique within its parent, so re-running Seed inserts nothing new.
func TestEntryClassTreeContract(t *testing.T) {
	trees := entryClassTrees()

	wantClasses := map[string]bool{"P1": true, "P4": true, "JSS1": true, "SSS1": true}
	if len(trees) != len(wantClasses) {
		t.Fatalf("entry trees: got %d classes, want %d", len(trees), len(wantClasses))
	}
	for code := range trees {
		if !wantClasses[code] {
			t.Errorf("unexpected entry class in seed: %s", code)
		}
	}

	// classTag is the ALLOWED exam set for a phase; mandatoryTag is the floor every
	// subject in the phase must carry. UTME is subject-specific at SSS — e.g. Civic
	// Education and Trade subjects sit WASSCE/NECO but are not JAMB/UTME subjects.
	classTag := map[string][]string{
		"P4":   {"CCE"},
		"JSS1": {"BECE"},
		"SSS1": {"WASSCE", "NECO", "UTME"},
	}
	mandatoryTag := map[string][]string{
		"P4":   {"CCE"},
		"JSS1": {"BECE"},
		"SSS1": {"WASSCE", "NECO"},
	}

	for classCode, subjects := range trees {
		if len(subjects) < 3 || len(subjects) > 5 {
			t.Errorf("class %s: %d subjects, want 3-5", classCode, len(subjects))
		}
		subjCodes := map[string]bool{}
		for _, sub := range subjects {
			if sub.code == "" || sub.name == "" {
				t.Errorf("class %s: subject missing code/name", classCode)
			}
			if subjCodes[sub.code] {
				t.Errorf("class %s: duplicate subject code %s (would break ON CONFLICT key)", classCode, sub.code)
			}
			subjCodes[sub.code] = true

			if len(sub.topics) < 1 || len(sub.topics) > 2 {
				t.Errorf("class %s subject %s: %d topics, want 1-2", classCode, sub.code, len(sub.topics))
			}
			topicCodes := map[string]bool{}
			for _, top := range sub.topics {
				if top.code == "" || top.title == "" {
					t.Errorf("class %s subject %s: topic missing code/title", classCode, sub.code)
				}
				if topicCodes[top.code] {
					t.Errorf("subject %s: duplicate topic code %s", sub.code, top.code)
				}
				topicCodes[top.code] = true

				if len(top.objectives) < 1 || len(top.objectives) > 3 {
					t.Errorf("topic %s: %d objectives, want 1-3", top.code, len(top.objectives))
				}
				objCodes := map[string]bool{}
				for _, obj := range top.objectives {
					if obj.code == "" || obj.title == "" {
						t.Errorf("topic %s: objective missing code/title", top.code)
					}
					if objCodes[obj.code] {
						t.Errorf("topic %s: duplicate objective code %s", top.code, obj.code)
					}
					objCodes[obj.code] = true
				}
			}

			// Exam-relevance rule per phase.
			if classCode == "P1" {
				if len(sub.examRelevance) != 0 {
					t.Errorf("P1 subject %s should carry no exam tags, got %v", sub.code, sub.examRelevance)
				}
			} else if allowed := classTag[classCode]; allowed != nil {
				if !isSubsetStrings(sub.examRelevance, allowed) {
					t.Errorf("class %s subject %s exam_relevance = %v, outside allowed %v",
						classCode, sub.code, sub.examRelevance, allowed)
				}
				for _, m := range mandatoryTag[classCode] {
					if !containsString(sub.examRelevance, m) {
						t.Errorf("class %s subject %s exam_relevance = %v, missing mandatory %s",
							classCode, sub.code, sub.examRelevance, m)
					}
				}
			}
		}
	}
}

// TestSeedNilPoolIsNoop verifies the idempotent/best-effort contract at the
// boundary: Seed(nil) must not panic and must return nil so startup never breaks.
func TestSeedNilPoolIsNoop(t *testing.T) {
	if err := Seed(nil, nil); err != nil {
		t.Fatalf("Seed(nil) should be a no-op nil, got %v", err)
	}
}

func containsString(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

// isSubsetStrings reports whether every element of a appears in allowed.
func isSubsetStrings(a, allowed []string) bool {
	if len(a) == 0 {
		return false // a subject must carry at least one exam tag at P4+
	}
	for _, x := range a {
		if !containsString(allowed, x) {
			return false
		}
	}
	return true
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
