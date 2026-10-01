package modules_test

// ---------------------------------------------------------------------------
// Contract test (AUD-OPS-001): every platform_modules.env_flag value must name
// a flag the backend actually reads. The registry resolves env_flag via a
// free-form os.Getenv at request time, while route mounts are gated by the
// getEnvBool names in config.go — when they drift (six rows did: e.g. registry
// FEATURE_ASSOCIATION_ENABLED vs mount FEATURE_ASSOCIATIONS_ENABLED) ops get a
// module that is "visible" but 503s, or mounted but unhideable.
//
// Migrations are replayed in filename order (timestamped names): INSERT seeds
// the value, later UPDATEs may correct it. The test asserts on the EFFECTIVE
// value per module key, so corrective migrations satisfy it.
// ---------------------------------------------------------------------------

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var (
	// ('key', 'Name', 'category', 'ENV_FLAG', ...) — 4th tuple field.
	seedTupleRe = regexp.MustCompile(`\('([a-zA-Z0-9]+)',\s*'[^']*',\s*'[^']*',\s*'([A-Z0-9_]*)'`)
	// UPDATE ... SET env_flag='FLAG' ... WHERE key='moduleKey'
	updateRe  = regexp.MustCompile(`SET\s+env_flag\s*=\s*'([A-Z0-9_]*)'[^;]*?WHERE\s+key\s*=\s*'([a-zA-Z0-9]+)'`)
	envReadRe = regexp.MustCompile(`(?:getEnvBool|getEnv|getEnvInt|os\.Getenv|os\.LookupEnv)\("([A-Z0-9_]+)"`)
)

func repoRoot(t *testing.T) string {
	t.Helper()
	// backend/internal/modules → repo root is ../../..
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatalf("repo root: %v", err)
	}
	return root
}

// effectiveEnvFlags replays platform_modules migrations in filename order and
// returns each module key's final env_flag value plus where it was last set.
func effectiveEnvFlags(t *testing.T) map[string]struct{ flag, src string } {
	t.Helper()
	root := repoRoot(t)
	type assign struct{ flag, src string }
	effective := map[string]assign{}

	var files []string
	err := filepath.Walk(filepath.Join(root, "supabase", "migrations"), func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && strings.HasSuffix(path, ".sql") {
			files = append(files, path)
		}
		return err
	})
	if err != nil {
		t.Fatalf("walk migrations: %v", err)
	}
	sort.Strings(files) // timestamped names ⇒ lexicographic = replay order

	for _, path := range files {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		s := string(body)
		if !strings.Contains(s, "platform_modules") {
			continue
		}
		rel, _ := filepath.Rel(root, path)
		for _, m := range seedTupleRe.FindAllStringSubmatch(s, -1) {
			effective[m[1]] = assign{flag: m[2], src: rel + " (seed)"}
		}
		for _, m := range updateRe.FindAllStringSubmatch(s, -1) {
			effective[m[2]] = assign{flag: m[1], src: rel + " (update)"}
		}
	}
	out := map[string]struct{ flag, src string }{}
	for k, v := range effective {
		out[k] = struct{ flag, src string }{v.flag, v.src}
	}
	return out
}

// declaredEnvNames returns every env var name the Go backend reads anywhere.
// A registry env_flag must resolve to one of these — otherwise it is a dead
// string an operator can set forever without effect on routes.
func declaredEnvNames(t *testing.T) map[string]bool {
	t.Helper()
	root := repoRoot(t)
	names := map[string]bool{}
	err := filepath.Walk(filepath.Join(root, "backend"), func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range envReadRe.FindAllStringSubmatch(string(body), -1) {
			names[m[1]] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk backend: %v", err)
	}
	return names
}

func TestModuleEnvFlags_ResolveToDeclaredBackendFlags(t *testing.T) {
	effective := effectiveEnvFlags(t)
	if len(effective) == 0 {
		t.Fatal("found no platform_modules rows — the test stopped checking anything")
	}
	declared := declaredEnvNames(t)
	for key, a := range effective {
		if a.flag == "" {
			continue // no kill switch — visibility is publication-only
		}
		if !declared[a.flag] {
			t.Errorf("module %q env_flag %q (from %s) is read by no backend code — fix the row to the real flag or declare it in config.go", key, a.flag, a.src)
		}
	}
}
