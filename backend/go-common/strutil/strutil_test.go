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
