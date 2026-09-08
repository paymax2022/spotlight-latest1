package buildinfo

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// The line's whole job is to be unmissable when the process is stale, so that is
// what gets asserted — not merely that it renders.
func TestLine_ShoutsWhenBehind(t *testing.T) {
	got := Line(Info{OK: true, Branch: "fix/assoc-logo-upload", Commit: "e1ea03b6", Behind: 28, BehindKnown: true})

	for _, want := range []string{"⚠️", "28 commit(s) BEHIND", "fix/assoc-logo-upload", "e1ea03b6"} {
		if !strings.Contains(got, want) {
			t.Errorf("line is missing %q, so a stale server would not announce itself:\n  %s", want, got)
		}
	}
}

func TestLine_SaysUpToDateOnlyWhenItIs(t *testing.T) {
	got := Line(Info{OK: true, Branch: "develop", Commit: "46fd88b7", BehindKnown: true})
	if strings.Contains(got, "BEHIND") {
		t.Errorf("a current tree was reported as behind:\n  %s", got)
	}
	// "local" is load-bearing: nothing fetches, so the ref may be stale and the
	// claim must not read as authoritative.
	if !strings.Contains(got, "local origin/develop") {
		t.Errorf("the ref must be named as LOCAL or the freshness claim overstates itself:\n  %s", got)
	}
}

// Without a develop ref there is nothing to compare against, and the line must
// say so rather than defaulting to a reassuring "up to date".
func TestLine_DoesNotClaimFreshnessWithNothingToCompare(t *testing.T) {
	got := Line(Info{OK: true, Branch: "develop", Commit: "46fd88b7"})
	if strings.Contains(got, "up to date") {
		t.Errorf("claimed freshness with no ref to compare against:\n  %s", got)
	}
}

func TestLine_DirtyTreeIsCalledOut(t *testing.T) {
	got := Line(Info{OK: true, Branch: "develop", Commit: "46fd88b7", Dirty: true, BehindKnown: true})
	if !strings.Contains(got, "DIRTY") {
		t.Errorf("a dirty tree serves code that exists in no commit; the line must say so:\n  %s", got)
	}
}

// A deployed image has no .git. Describe must degrade to a plain statement
// rather than an error or a crash — this runs on every boot.
func TestDescribe_NonRepoIsNotAnError(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	dir := t.TempDir()
	info := Describe(context.Background(), dir)
	if info.OK {
		t.Fatalf("a temp dir was reported as a git checkout: %+v", info)
	}
	if got := Line(info); !strings.Contains(got, "not a git checkout") {
		t.Errorf("unhelpful line for a non-repo: %s", got)
	}
}

// The real path, against this repository.
func TestDescribe_ReadsThisRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	info := Describe(context.Background(), wd)
	if !info.OK {
		t.Skip("tests are not running inside a git checkout")
	}
	if info.Commit == "" {
		t.Error("OK was reported with no commit")
	}
}
