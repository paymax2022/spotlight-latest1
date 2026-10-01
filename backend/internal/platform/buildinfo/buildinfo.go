// Package buildinfo answers one question at startup: what source is this
// process actually serving?
// WHY IT EXISTS. A running server is a SNAPSHOT of its source at the moment it
// started, not a follower of the tree it was built from. :8091 is shared by
// every session and runs from whichever checkout someone last started it in, so
// the tree can move — or the whole checkout can be a different one than you
// assume — while the process serves the code it compiled days ago.
// That has now cost real time three separate times. The last case: :8091 was
// serving a marketplace listing path with no photo persistence, the fix had been
// on develop for two days, and the checkout it ran from was a stale feature
// branch nobody realised was involved. Diagnosing it meant reading `ps -o lstart`
// against commit timestamps and `lsof -p <pid> | grep cwd` — all recoverable, but
// only if you already suspect the process rather than the code in front of you.
// One line at startup makes the server say it itself.

package buildinfo

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// gitTimeout is per command. Generous enough for a cold filesystem, short enough
// that a wedged git can never hold up a boot: this is a diagnostic, and it must
// never be the reason a server fails to come up.
const gitTimeout = 2 * time.Second

// Info is what could be learned about the working tree. Every field is
// best-effort; OK reports whether git answered at all.
type Info struct {
	OK     bool
	Branch string
	Commit string
	Dirty  bool

	// Behind counts commits on the LOCAL origin/develop ref that are not on HEAD.
	// BehindKnown is false when there is no such ref to compare against.
	Behind      int
	BehindKnown bool
}

// Describe inspects the working tree at dir. It returns Info{} with OK false —
// never an error — when git is absent, dir is not a repository, or a command
// times out. A deployed image has no .git and is expected to land here.
func Describe(ctx context.Context, dir string) Info {
	rev, ok := git(ctx, dir, "rev-parse", "--short", "HEAD")
	if !ok {
		return Info{}
	}
	info := Info{OK: true, Commit: rev}

	if branch, ok := git(ctx, dir, "rev-parse", "--abbrev-ref", "HEAD"); ok {
		info.Branch = branch
	}
	// --porcelain prints nothing for a clean tree, so emptiness IS the answer.
	if status, ok := git(ctx, dir, "status", "--porcelain"); ok {
		info.Dirty = status != ""
	}
	if behind, ok := git(ctx, dir, "rev-list", "--count", "HEAD..origin/develop"); ok {
		if n, err := strconv.Atoi(behind); err == nil {
			info.Behind, info.BehindKnown = n, true
		}
	}
	return info
}

// Line renders Info as a single log line.
// It says "local origin/develop" rather than "origin/develop" on purpose. The
// comparison is against the remote-tracking ref as it stands on disk, and
// nothing here fetches — a network call at startup could hang the boot, which is
// a worse failure than a stale number. So the ref may itself be days old, and a
// silent "up to date" would be exactly the kind of false green this line exists
// to prevent. Naming the ref as local is what keeps the claim honest.
func Line(i Info) string {
	if !i.OK {
		return "[source] not a git checkout — cannot report branch or staleness"
	}

	b := i.Branch
	if b == "" || b == "HEAD" {
		b = "(detached)"
	}
	state := "clean"
	if i.Dirty {
		state = "DIRTY — serving code that exists in no commit"
	}

	switch {
	case !i.BehindKnown:
		return fmt.Sprintf("[source] branch=%s commit=%s %s — no local origin/develop to compare against", b, i.Commit, state)
	case i.Behind > 0:
		return fmt.Sprintf(
			"[source] branch=%s commit=%s %s — ⚠️ %d commit(s) BEHIND local origin/develop; a recent fix may not be in this process",
			b, i.Commit, state, i.Behind)
	default:
		return fmt.Sprintf("[source] branch=%s commit=%s %s — up to date with local origin/develop", b, i.Commit, state)
	}
}

func git(ctx context.Context, dir string, args ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()

	full := append([]string{"-C", dir}, args...)
	out, err := exec.CommandContext(ctx, "git", full...).Output()
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(out)), true
}

// Release answers "what commit is THIS process serving?" from outside the box.
// WHY THIS IS SEPARATE FROM Describe. Describe shells out to git, and a deployed
// image has no .git — the package doc already says so, and it returns OK false
// there by design. That is fine for the local startup line, but it means a
// deployed server cannot say what it is running, which is precisely when you most
// need to know.
// This has cost real time. Verifying a staging deploy meant reading GitHub job
// conclusions and trusting Railway's own status, because the only external probe
// was /api/v1/public/health, whose body is a fixed string identical on every
// build. A health check that answers the same before and after a deploy cannot
// distinguish "deployed" from "did not deploy" — the exact false-green this
// codebase keeps getting caught by.
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
