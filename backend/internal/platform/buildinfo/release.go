package buildinfo

import (
	"context"
	"os"
	"strings"
	"time"
)

// Release answers "what commit is THIS process serving?" from outside the box.
//
// WHY THIS IS SEPARATE FROM Describe. Describe shells out to git, and a deployed
// image has no .git — the package doc already says so, and it returns OK false
// there by design. That is fine for the local startup line, but it means a
// deployed server cannot say what it is running, which is precisely when you most
// need to know.
//
// This has cost real time. Verifying a staging deploy meant reading GitHub job
// conclusions and trusting Railway's own status, because the only external probe
// was /api/v1/public/health, whose body is a fixed string identical on every
// build. A health check that answers the same before and after a deploy cannot
// distinguish "deployed" from "did not deploy" — the exact false-green this
// codebase keeps getting caught by.
//
// injectedCommit is set at BUILD time with:
//
//	go build -ldflags "-X spotlight/backend/internal/platform/buildinfo.injectedCommit=<sha>"
//
// It is a var, not a const, and deliberately unexported: nothing may write it at
// runtime, or the endpoint could report a commit this binary was not built from.
var injectedCommit string

// startedAt is fixed at process start. Two probes returning the same value mean
// the same process answered — a restart is visible even when the commit is not.
var startedAt = time.Now().UTC()

// Release is the externally reportable identity of a running server.
type Release struct {
	// Commit is the build's git SHA, or "" when nothing supplied one. Empty is
	// reported honestly rather than filled with a guess: a wrong commit is worse
	// than a missing one, because it would be believed.
	Commit string `json:"commit"`
	// Source records HOW Commit was determined, so a reader can judge how much to
	// trust it: "ldflags", "env", "git", or "unknown".
	Source string `json:"source"`
	// Branch and Dirty are best-effort and only ever known from git, so they are
	// absent in a deployed image.
	Branch string `json:"branch,omitempty"`
	Dirty  bool   `json:"dirty,omitempty"`
	// StartedAt is when THIS process began, RFC3339 UTC.
	StartedAt string `json:"started_at"`
	// UptimeSeconds makes a restart obvious at a glance.
	UptimeSeconds int64 `json:"uptime_seconds"`
}

// CurrentRelease resolves the running build's identity, most trustworthy source
// first. It never returns an error and never blocks longer than the git timeout:
// this is a diagnostic, and it must not be able to take a server down.
//
// Order, and why:
//  1. ldflags — baked into the binary at compile time, so it cannot drift from
//     the code that is actually running.
//  2. BUILD_COMMIT / RAILWAY_GIT_COMMIT_SHA env — set by the deploy pipeline.
//     Trustworthy but weaker: the environment can be edited without rebuilding.
//  3. git — only meaningful in a local checkout, where it is also the most
//     accurate answer available.
//  4. unknown — say so plainly.
func CurrentRelease(ctx context.Context, dir string) Release {
	r := Release{
		Source:        "unknown",
		StartedAt:     startedAt.Format(time.RFC3339),
		UptimeSeconds: int64(time.Since(startedAt).Seconds()),
	}

	if c := strings.TrimSpace(injectedCommit); c != "" {
		r.Commit, r.Source = c, "ldflags"
		return r
	}
	// RAILWAY_GIT_COMMIT_SHA is set for git-connected Railway deploys. Our staging
	// deploys upload via `railway up` instead, so it is usually absent — it is
	// read anyway because it costs nothing and is correct when present.
	for _, key := range []string{"BUILD_COMMIT", "RAILWAY_GIT_COMMIT_SHA", "SOURCE_COMMIT"} {
		if c := strings.TrimSpace(os.Getenv(key)); c != "" {
			r.Commit, r.Source = c, "env"
			return r
		}
	}
	if i := Describe(ctx, dir); i.OK {
		r.Commit, r.Source, r.Branch, r.Dirty = i.Commit, "git", i.Branch, i.Dirty
		return r
	}
	return r
}
