package strutil_test

import (
	"testing"

	"spotlight/backend/go-common/strutil"
)

func TestFirstNonEmpty(t *testing.T) {
	if got := strutil.FirstNonEmpty("", "", "x", "y"); got != "x" {
		t.Fatalf("FirstNonEmpty = %q", got)
	}
	if got := strutil.FirstNonEmpty("", ""); got != "" {
		t.Fatalf("FirstNonEmpty all-empty = %q", got)
	}
}

func TestFirstNonBlank(t *testing.T) {
	if got := strutil.FirstNonBlank("   ", "\t", " v "); got != " v " {
		t.Fatalf("FirstNonBlank = %q", got)
	}
	if got := strutil.FirstNonBlank(" ", ""); got != "" {
		t.Fatalf("FirstNonBlank all-blank = %q", got)
	}
}

func TestOr(t *testing.T) {
	if strutil.Or("", "d") != "d" || strutil.Or("v", "d") != "v" {
		t.Fatal("Or wrong")
	}
	if strutil.OrBlank("  ", "d") != "d" {
		t.Fatal("OrBlank wrong")
	}
}

func TestNormalize(t *testing.T) {
	if got := strutil.Normalize("  Hello  "); got != "hello" {
		t.Fatalf("Normalize = %q", got)
	}
	if got := strutil.NormalizeCode(" ab-cd "); got != "AB-CD" {
		t.Fatalf("NormalizeCode = %q", got)
	}
}

func TestTruncate(t *testing.T) {
	if got := strutil.Truncate("hello", 3); got != "hel" {
		t.Fatalf("Truncate = %q", got)
	}
	if got := strutil.Truncate("hi", 10); got != "hi" {
		t.Fatalf("Truncate short = %q", got)
	}
	if got := strutil.Truncate("hi", -1); got != "hi" {
		t.Fatalf("Truncate negative = %q", got)
	}
}

func TestTruncateRunes_UTF8(t *testing.T) {
	got := strutil.TruncateRunes("héllo", 2)
	if got != "hé" {
		t.Fatalf("TruncateRunes = %q", got)
	}
	if got := strutil.Ellipsis("hello world", 5); got != "hell…" {
		t.Fatalf("Ellipsis = %q", got)
	}
}

func TestMaskRightLeft(t *testing.T) {
	if got := strutil.MaskRight("08031234567", 4); got != "0803*******" {
		t.Fatalf("MaskRight = %q", got)
	}
	if got := strutil.MaskLeft("1234567890", 4); got != "******7890" {
		t.Fatalf("MaskLeft = %q", got)
	}
	if got := strutil.MaskRight("ab", 5); got != "ab" {
		t.Fatalf("MaskRight keep>len = %q", got)
	}
}

func TestContainsFoldEqualFold(t *testing.T) {
	if !strutil.ContainsFold("Hello World", "world") {
		t.Fatal("ContainsFold missed")
	}
	if !strutil.EqualFold("  ABC ", "abc") {
		t.Fatal("EqualFold wrong")
	}
}

func TestSplitCSV(t *testing.T) {
	got := strutil.SplitCSV(" a ,b,,  c ")
	if len(got) != 3 || got[0] != "a" || got[2] != "c" {
		t.Fatalf("SplitCSV = %v", got)
	}
	if strutil.SplitCSV("") != nil {
		t.Fatal("SplitCSV(\"\") must be nil")
	}
}

func TestJoinNonEmpty(t *testing.T) {
	if got := strutil.JoinNonEmpty(", ", "Lagos", "", "Nigeria"); got != "Lagos, Nigeria" {
		t.Fatalf("JoinNonEmpty = %q", got)
	}
	if got := strutil.JoinNonEmpty(", ", "", " "); got != "" {
		t.Fatalf("JoinNonEmpty all-empty = %q", got)
	}
}

func TestNormalizeSpace(t *testing.T) {
	if got := strutil.NormalizeSpace("  a   b\n\tc "); got != "a b c" {
		t.Fatalf("NormalizeSpace = %q", got)
	}
}

func TestCap(t *testing.T) {
	if strutil.Cap("hello") != "Hello" || strutil.Cap("") != "" {
		t.Fatal("Cap wrong")
	}
}

func TestInitials(t *testing.T) {
	if got := strutil.Initials("Ada Lovelace", 2); got != "AL" {
		t.Fatalf("Initials = %q", got)
	}
	if got := strutil.Initials("ada lovelace extra", 0); got != "AL" {
		t.Fatalf("Initials default-n = %q", got)
	}
}

func TestSnake(t *testing.T) {
	if got := strutil.Snake("CamelCase"); got != "camel_case" {
		t.Fatalf("Snake = %q", got)
	}
	if got := strutil.Snake("user id-here"); got != "user_id_here" {
		t.Fatalf("Snake spaces = %q", got)
	}
}
