// commentstrip removes *useless* comments from Go and TypeScript source.
//
//	REMOVE:  commented-out code (incl. whole /* */ code blocks), decorative
//	         separator lines, empty comment markers, restatements (comments
//	         whose words all appear in the adjacent code line).
//	KEEP:    godoc on exported Go decls, directives (//go:, //nolint,
//	         //go:build, eslint-*, @ts-*, ///, prettier-ignore), license
//	         headers, TODO/FIXME/NOTE/SAFETY/SECURITY/PERF/HACK/BUG markers,
//	         comments containing URLs or ADR/issue references, JSDoc blocks,
//	         genuine prose.
//
// Usage:
//
//	go run tools/commentstrip/main.go -w <file|dir>...
//	go run tools/commentstrip/main.go -dry <dir>   # report only
//
// -w rewrites in place and runs gofmt on touched .go files.
package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	dry   = flag.Bool("dry", false, "report what would be removed, do not write")
	write = flag.Bool("w", false, "rewrite files in place")
)

var decoration = regexp.MustCompile(`^[\s\-=_~*#.+/\\|<>─━═│┃┄┈]+$`)

// banner is a label sandwiched in decoration: "// ======== SECTION ========".
// Organizational noise — the section content is already visible in the code.
var banner = regexp.MustCompile(`^[\s\-=_~*#.─━═│┃<>]{2,}[^\-=_~*#.─━═│┃<>]*[\s\-=_~*#.─━═│┃<>]{2,}$|^[\s\-=_~*#.─━═│┃<>]{3,}`)

var keepMarkers = regexp.MustCompile(`(?i)\b(TODO|FIXME|XXX|NOTE|HACK|BUG|SAFETY|SECURITY|PERF|WORKAROUND|ADR|RFC|WARNING|WARN\b|IMPORTANT|CRITICAL|DANGER|CAUTION|DEPRECATED|#[0-9]+|https?://|@see|@deprecated|license|copyright|spdx|upstream|CVE-)\b`)

var directive = regexp.MustCompile(`^(go:|go:build|\+build|nolint|lint:|line |export |embed\b|eslint|@ts-|@jest|@vitest|pragma|///|prettier-ignore|istanbul|webpack|generated|DO NOT EDIT)`)

var wordRe = regexp.MustCompile(`[a-z0-9_]+`)

var whyMarkers = regexp.MustCompile(`(?i)\b(because|since|must|never|cannot|can't|only|unless|otherwise|avoid|prevent|ensure|workaround|legacy|contract|required|invariant|audit|leak|race|idempotent|immutable|ordering|ordering|before|after|once|twice|distinguish|fallback|prevents|avoids)\b`)

var goCodeTokens = regexp.MustCompile(`(:=|\bif\b|\bfor\b|\breturn\b|\bfunc\b|\bvar\b|\bconst\b|\.String\(\)|\.Error\(\)|\bappend\(|\blen\(|\brange\b|\bgo\b |defer |select |case |switch |make\(|\.\w+\()`)

var tsCode = regexp.MustCompile(`(=>|\bconst\b|\blet\b|\bvar\b|\bfunction\b|\breturn\b|\bimport\b|\bexport\b|\bawait\b|\basync\b|console\.|\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\.\w+\(.*\)|[\w$\]]+\s*=\s*[^=>]|^\w+\s*:\s*\w+|//.*;$|^\}|;)`)

func words(s string) []string { return wordRe.FindAllString(strings.ToLower(s), -1) }

// looksLikeGoCode reports whether the comment body parses as Go.
func looksLikeGoCode(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 4 {
		return false
	}
	if _, err := parser.ParseFile(token.NewFileSet(), "", "package p\n"+s, parser.SkipObjectResolution); err == nil {
		return true
	}
	if !goCodeTokens.MatchString(s) && !strings.ContainsAny(s, "=({};") {
		return false
	}
	_, err := parser.ParseFile(token.NewFileSet(), "", "package p\nfunc f(){\n"+s+"\n}", parser.SkipObjectResolution)
	return err == nil
}

// looksLikeTS: heuristic for commented-out TypeScript. Requires code tokens
// and refuses natural sentences (Capitalized + trailing period + many words).
func looksLikeTS(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 4 || strings.Contains(s, "http") {
		return false
	}
	if strings.HasSuffix(s, ".") && strings.Count(s, " ") > 3 {
		return false
	}
	return tsCode.MatchString(s)
}

// isRestatement: >=80% of the comment's words appear in the adjacent code
// line ("get the user" above "u := getUser(ctx)") — unless it carries a
// why-marker, which signals rationale rather than narration.
func isRestatement(comment, codeLine string) bool {
	cw := words(comment)
	if len(cw) < 2 || whyMarkers.MatchString(comment) {
		return false
	}
	code := map[string]bool{}
	for _, w := range words(codeLine) {
		code[w] = true
	}
	hit := 0
	for _, w := range cw {
		if code[w] {
			hit++
		}
	}
	return hit*100 >= len(cw)*80
}

func nextCodeLine(lines []string, i int) string {
	for ; i < len(lines); i++ {
		t := strings.TrimSpace(lines[i])
		if t == "" || strings.HasPrefix(t, "//") || strings.HasPrefix(t, "/*") || strings.HasPrefix(t, "*") {
			continue
		}
		return t
	}
	return ""
}

var exportedDecl = regexp.MustCompile(`^(func|type|var|const)\s+(\([^\)]*\)\s*)?[A-Z]`)

func isDocPosition(lines []string, i int) bool {
	return exportedDecl.MatchString(nextCodeLine(lines, i))
}

// classifyLineComment decides keep/drop for one // body. isGo selects the
// code detector; docPos means "sits above an exported decl".
func classifyLineComment(body string, docPos bool, next string, isGo bool) bool {
	body = strings.TrimSpace(body)
	switch {
	case directive.MatchString(body):
		return true
	case keepMarkers.MatchString(body):
		return true
	case body == "":
		return false
	case decoration.MatchString(body) || banner.MatchString(body):
		return false
	case isGo && looksLikeGoCode(body):
		return false
	case !isGo && looksLikeTS(body):
		return false
	case docPos:
		return true // godoc on exported decl — keep even if short
	case isRestatement(body, next):
		return false
	}
	return true
}

// blockIsCode: every non-empty content line of a /* */ block looks like code.
func blockIsCode(blockLines []string, isGo bool) bool {
	nonEmpty := 0
	codeish := 0
	for _, l := range blockLines {
		t := strings.TrimSpace(l)
		t = strings.TrimPrefix(t, "/*")
		t = strings.TrimSuffix(t, "*/")
		t = strings.TrimPrefix(t, "*")
		t = strings.TrimSpace(t)
		if t == "" || decoration.MatchString(t) {
			continue
		}
		nonEmpty++
		if isGo && looksLikeGoCode(t) {
			codeish++
		} else if !isGo && looksLikeTS(t) {
			codeish++
		}
	}
	return nonEmpty > 0 && codeish == nonEmpty
}

func blockKeep(blockLines []string) bool {
	joined := strings.Join(blockLines, " ")
	low := strings.ToLower(joined)
	if strings.Contains(low, "copyright") || strings.Contains(low, "license") || strings.Contains(low, "spdx") {
		return true
	}
	if keepMarkers.MatchString(joined) || strings.HasPrefix(strings.TrimSpace(blockLines[0]), "/**") {
		return true
	}
	return false
}

type stats struct {
	files, removed int
}

// trailingIdx finds "//" that starts a trailing comment, skipping strings.
func trailingIdx(line string) int {
	inStr := false
	var quote byte
	for i := 0; i+1 < len(line); i++ {
		c := line[i]
		if inStr {
			if c == quote && line[i-1] != '\\' {
				inStr = false
			}
			continue
		}
		if c == '"' || c == '`' || c == '\'' {
			inStr = true
			quote = c
			continue
		}
		if c == '/' && line[i+1] == '/' {
			if i == 0 {
				return -1
			}
			return i
		}
	}
	return -1
}

func processFile(path string, st *stats) error {
	src, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	isGo := strings.HasSuffix(path, ".go")
	sc := bufio.NewScanner(bytes.NewReader(src))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	var lines []string
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}

	var out []string
	removed := 0
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trim := strings.TrimSpace(line)

		// block comment: buffer until */
		if strings.HasPrefix(trim, "/*") {
			var block []string
			j := i
			for ; j < len(lines); j++ {
				block = append(block, lines[j])
				if strings.Contains(lines[j], "*/") {
					break
				}
			}
			i = j
			switch {
			case blockKeep(block):
				out = append(out, block...)
			case blockIsCode(block, isGo):
				removed += len(block)
			default:
				out = append(out, block...)
			}
			continue
		}

		if strings.HasPrefix(trim, "//") {
			body := strings.TrimSpace(strings.TrimPrefix(trim, "//"))
			nxt := nextCodeLine(lines, i+1)
			if classifyLineComment(body, isDocPosition(lines, i+1), nxt, isGo) {
				out = append(out, line)
			} else {
				removed++
			}
			continue
		}

		if idx := trailingIdx(line); idx >= 0 {
			body := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line[idx:]), "//"))
			codePart := strings.TrimSpace(line[:idx])
			drop := false
			switch {
			case directive.MatchString(body) || keepMarkers.MatchString(body):
			case decoration.MatchString(body) || body == "":
				drop = true
			case isGo && looksLikeGoCode(body):
				drop = true
			case !isGo && looksLikeTS(body):
				drop = true
			case isRestatement(body, codePart):
				drop = true
			}
			if drop {
				line = strings.TrimRight(line[:idx], " \t")
				removed++
			}
		}
		out = append(out, line)
	}

	if removed == 0 {
		return nil
	}
	st.removed += removed
	st.files++
	if *dry {
		fmt.Printf("%s: -%d comments\n", path, removed)
		return nil
	}
	if !*write {
		return nil
	}
	var final []string
	blanks := 0
	for _, l := range out {
		if strings.TrimSpace(l) == "" {
			blanks++
			if blanks > 1 {
				continue
			}
		} else {
			blanks = 0
		}
		final = append(final, l)
	}
	if err := os.WriteFile(path, []byte(strings.Join(final, "\n")+"\n"), 0o644); err != nil {
		return err
	}
	if isGo {
		exec.Command("gofmt", "-w", path).Run()
	}
	return nil
}

func main() {
	flag.Parse()
	var st stats
	for _, root := range flag.Args() {
		info, err := os.Stat(root)
		if err != nil {
			fmt.Fprintln(os.Stderr, root, err)
			continue
		}
		if !info.IsDir() {
			processFile(root, &st)
			continue
		}
		filepath.Walk(root, func(p string, fi os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if fi.IsDir() {
				switch fi.Name() {
				case "node_modules", ".next", "vendor", "dist", "build", ".git":
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasSuffix(p, ".go") || strings.HasSuffix(p, ".ts") || strings.HasSuffix(p, ".tsx") {
				processFile(p, &st)
			}
			return nil
		})
	}
	fmt.Printf("commentstrip: %d files changed, %d comments removed\n", st.files, st.removed)
}
