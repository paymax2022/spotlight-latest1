package connectvoting

// The rule "which submission states may a voter hear" is written twice, in two
// languages: PUBLICLY_PLAYABLE_SONG_STATUSES in
// frontend-web/src/features/openmic/song-storage.ts (which the web reader
// enforces on the bytes) and publiclyPlayableSongStatuses here (which decides
// what the roster advertises). Neither can import the other, and drift is not
// cosmetic: add a status here and the roster hands phones a url the web reader
// answers 404 for; drop one here and a finalist whose song plays on the web
// goes silent in the app.
//
// So this test reads the TypeScript and compares. It is a DB-free contract test
// in the style of backend/internal/modules/envflag_contract_test.go, and it
// also pins that the SQL binds the Go list instead of re-typing literals —
// inlined literals would pass the list comparison while quietly creating a
// third copy.

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// repoRootFromVotingPkg walks up from backend/internal/connect/voting.
func repoRootFromVotingPkg(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "frontend-web", "src", "features", "openmic", "song-storage.ts")); err != nil {
		t.Fatalf("repo root %s does not hold the web song-storage file: %v", root, err)
	}
	return root
}

var tsStatusArrayRE = regexp.MustCompile(`PUBLICLY_PLAYABLE_SONG_STATUSES\s*=\s*\[([^\]]*)\]`)

// The web list is written in single quotes; accept either style so a formatter
// that switches quote character cannot silently produce an empty comparison.
var quotedRE = regexp.MustCompile(`['"]([^'"]+)['"]`)

func TestSongStatusParityWithWeb(t *testing.T) {
	root := repoRootFromVotingPkg(t)

	body, err := os.ReadFile(filepath.Join(root, "frontend-web", "src", "features", "openmic", "song-storage.ts"))
	if err != nil {
		t.Fatalf("read web song-storage: %v", err)
	}
	group := tsStatusArrayRE.FindSubmatch(body)
	if group == nil {
		t.Fatal("could not find PUBLICLY_PLAYABLE_SONG_STATUSES in the web source — the constant was renamed or deleted, " +
			"and the roster query must be updated in the same change")
	}
	var web []string
	for _, m := range quotedRE.FindAllStringSubmatch(string(group[1]), -1) {
		web = append(web, m[1])
	}

	// Order is part of the contract: the chooser takes the first match it finds
	// newest-first, and a reordered list changes which submission a voter hears
	// when one artist has several.
	if !slices.Equal(web, publiclyPlayableSongStatuses) {
		t.Errorf("playable-status lists drifted:\n  web: %v\n  go:  %v", web, publiclyPlayableSongStatuses)
	}

	// A draft must never be publicly playable, whatever the lists otherwise say.
	if slices.Contains(publiclyPlayableSongStatuses, "draft") {
		t.Error("draft is the artist's own preview state and must stay out of the public roster")
	}

	// The SQL must bind the Go list, not carry its own copy.
	join := rosterSongJoin("$4")
	if !strings.Contains(join, "= ANY($4::text[])") {
		t.Error("rosterSongJoin must bind publiclyPlayableSongStatuses as an array parameter")
	}
	for _, status := range publiclyPlayableSongStatuses {
		if strings.Contains(join, "'"+status+"'") {
			t.Errorf("rosterSongJoin hard-codes %q; that is a third copy of the rule", status)
		}
	}

	// Both roster queries have to use the shared join, or the profile screen and
	// the list screen pick different songs for the same artist.
	repoSrc, err := os.ReadFile(filepath.Join(root, "backend", "internal", "connect", "voting", "repo.go"))
	if err != nil {
		t.Fatalf("read repo.go: %v", err)
	}
	if n := strings.Count(string(repoSrc), `rosterSongJoin("$`); n != 2 {
		t.Errorf("expected the shared song join in both roster queries, found %d use(s)", n)
	}
}
