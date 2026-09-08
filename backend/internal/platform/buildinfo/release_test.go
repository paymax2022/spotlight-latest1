package buildinfo

import (
	"context"
	"testing"
)

// The contract these pin: a reported commit must be TRUSTWORTHY or absent.
// The endpoint exists so a deploy can be verified from outside, and a wrong
// commit would be worse than a missing one — it would be believed, and the next
// person would "verify" a deploy against a value that means nothing.

func TestCurrentRelease_PrefersLdflagsOverEverything(t *testing.T) {
	// ldflags is baked in at compile time and cannot drift from the running code,
	// so it must win even when the environment says otherwise — an edited env var
	// must never be able to make a binary misreport itself.
	t.Setenv("BUILD_COMMIT", "from-env")
	old := injectedCommit
	injectedCommit = "from-ldflags"
	t.Cleanup(func() { injectedCommit = old })

	r := CurrentRelease(context.Background(), t.TempDir())
	if r.Commit != "from-ldflags" || r.Source != "ldflags" {
		t.Fatalf("ldflags must win: got commit=%q source=%q", r.Commit, r.Source)
	}
}

func TestCurrentRelease_FallsBackToEnv(t *testing.T) {
	old := injectedCommit
	injectedCommit = ""
	t.Cleanup(func() { injectedCommit = old })
	t.Setenv("BUILD_COMMIT", "sha-from-env")

	// t.TempDir() is not a git repo, so the git branch cannot answer either.
	r := CurrentRelease(context.Background(), t.TempDir())
	if r.Commit != "sha-from-env" || r.Source != "env" {
		t.Fatalf("env fallback: got commit=%q source=%q", r.Commit, r.Source)
	}
}

func TestCurrentRelease_UnknownIsReportedHonestly(t *testing.T) {
	old := injectedCommit
	injectedCommit = ""
	t.Cleanup(func() { injectedCommit = old })
	// Explicitly clear every env key the resolver consults.
	for _, k := range []string{"BUILD_COMMIT", "RAILWAY_GIT_COMMIT_SHA", "SOURCE_COMMIT"} {
		t.Setenv(k, "")
	}

	r := CurrentRelease(context.Background(), t.TempDir())
	if r.Commit != "" {
		t.Fatalf("must NOT invent a commit, got %q", r.Commit)
	}
	if r.Source != "unknown" {
		t.Fatalf("must say the source is unknown, got %q", r.Source)
	}
}

func TestCurrentRelease_IgnoresWhitespaceOnlyValues(t *testing.T) {
	// A stamping step that wrote an empty line must not produce a blank-but-present
	// commit — that would read as "known" while carrying no information.
	old := injectedCommit
	injectedCommit = "   \n"
	t.Cleanup(func() { injectedCommit = old })
	for _, k := range []string{"BUILD_COMMIT", "RAILWAY_GIT_COMMIT_SHA", "SOURCE_COMMIT"} {
		t.Setenv(k, "")
	}

	r := CurrentRelease(context.Background(), t.TempDir())
	if r.Source != "unknown" || r.Commit != "" {
		t.Fatalf("whitespace must not count as a commit: got commit=%q source=%q", r.Commit, r.Source)
	}
}

func TestCurrentRelease_AlwaysReportsProcessIdentity(t *testing.T) {
	// StartedAt distinguishes "same process still running" from "restarted" even
	// when the commit is unknown, which is the case for every currently-deployed
	// build until the next release.
	r := CurrentRelease(context.Background(), t.TempDir())
	if r.StartedAt == "" {
		t.Fatal("StartedAt must always be set")
	}
	if r.UptimeSeconds < 0 {
		t.Fatalf("UptimeSeconds must not be negative, got %d", r.UptimeSeconds)
	}
}
