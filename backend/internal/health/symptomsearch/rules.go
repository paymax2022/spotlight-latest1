package symptomsearch

// Cluster-rule expression DSL — parsed and evaluated in Go, stored as text in
// symptom_cluster_rules.expression. Grammar (migration header, verbatim):
//
//	rule        := or_expr
//	or_expr     := and_expr { "OR" and_expr }
//	and_expr    := unary { "AND" unary }
//	unary       := [ "NOT" ] primary
//	primary     := "(" or_expr ")" | predicate
//	predicate   := "concept:" CODE                 -- CODE := [a-z][a-z0-9_]*
//	             | "who:" COHORT                   -- COHORT ∈ ValidCohorts
//	             | "duration_days" OP INT          -- OP ∈ { < , <= , = , >= , > }
//	             | "term_count" OP INT
//
// Precedence: NOT > AND > OR. Keywords are case-sensitive UPPERCASE.
// Semantics:
//   - concept:X is true iff X is among the concepts the user's terms resolved to.
//   - who: matches only an EXPLICITLY selected cohort refiner.
//   - duration buckets map TODAY→1, D2_3→3, GT_3D→4 days; when NO duration
//     refiner was provided (DurationDays <= 0) every duration_days predicate is
//     false — a rule never fires on unknown data.
//
// FAIL-CLOSED: an APPROVED rule that fails to parse at evaluation time forces
// escalation of the whole resolution to T3 (see Service.Resolve) — a broken
// safety rule is never silently skipped.
//
// The parser is a dependency-free recursive descent over a whitespace/paren
// lexer. Parsing is deterministic and pure — same input, same output.

import (
	"fmt"
	"strconv"
	"strings"
)

// EvalContext is the fact set an expression is evaluated against.
type EvalContext struct {
	Concepts     map[string]bool // matched concept codes (global across clusters)
	Who          string          // explicit cohort refiner; "" when not selected
	DurationDays int             // 0 = not provided ⇒ duration predicates are false
	TermCount    int             // count of normalised input terms
}

// ─── AST ─────────────────────────────────────────────────────────────────────

type ruleNode interface {
	eval(ctx *EvalContext) bool
}

type orNode struct{ left, right ruleNode }

func (n orNode) eval(ctx *EvalContext) bool { return n.left.eval(ctx) || n.right.eval(ctx) }

type andNode struct{ left, right ruleNode }

func (n andNode) eval(ctx *EvalContext) bool { return n.left.eval(ctx) && n.right.eval(ctx) }

type notNode struct{ inner ruleNode }

func (n notNode) eval(ctx *EvalContext) bool { return !n.inner.eval(ctx) }

type conceptNode struct{ code string }

func (n conceptNode) eval(ctx *EvalContext) bool { return ctx.Concepts[n.code] }

type whoNode struct{ cohort string }

// who: matches only an EXPLICITLY selected cohort refiner (never a default).
func (n whoNode) eval(ctx *EvalContext) bool { return ctx.Who != "" && ctx.Who == n.cohort }

type cmpNode struct {
	field string // duration_days | term_count
	op    string // < <= = >= >
	value int
}

func (n cmpNode) eval(ctx *EvalContext) bool {
	var actual int
	switch n.field {
	case "duration_days":
		if ctx.DurationDays <= 0 {
			return false // unknown duration never satisfies a duration predicate
		}
		actual = ctx.DurationDays
	case "term_count":
		actual = ctx.TermCount
	default:
		return false
	}
	switch n.op {
	case "<":
		return actual < n.value
	case "<=":
		return actual <= n.value
	case "=":
		return actual == n.value
	case ">=":
		return actual >= n.value
	case ">":
		return actual > n.value
	}
	return false
}

// ─── Public surface ──────────────────────────────────────────────────────────

// CompiledRule is a parsed, immutable rule expression.
type CompiledRule struct{ root ruleNode }

// Eval evaluates the compiled rule against the fact set. Deterministic.
func (r *CompiledRule) Eval(ctx *EvalContext) bool {
	if r == nil || r.root == nil || ctx == nil {
		return false
	}
	return r.root.eval(ctx)
}

// maxRuleExpressionLen mirrors the schema CHECK (1–500 chars) and the admin
// write-time cap. Enforced here too so the parser's recursion depth is bounded
// even against rows written outside the app path (defence in depth).
const maxRuleExpressionLen = 500

// ParseRule parses a rule expression. A non-nil error means the expression is
// malformed — callers on the read path MUST treat that as a T3 escalation.
func ParseRule(expr string) (*CompiledRule, error) {
	if len(expr) > maxRuleExpressionLen {
		return nil, fmt.Errorf("symptomsearch: rule expression exceeds %d characters", maxRuleExpressionLen)
	}
	toks, err := lexRule(expr)
	if err != nil {
		return nil, err
	}
	if len(toks) == 0 {
		return nil, fmt.Errorf("symptomsearch: empty rule expression")
	}
	p := &ruleParser{toks: toks}
	root, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if p.pos != len(p.toks) {
		return nil, fmt.Errorf("symptomsearch: unexpected trailing token %q", p.toks[p.pos])
	}
	return &CompiledRule{root: root}, nil
}

// EvaluateExpression parses and evaluates in one step. The error is the
// fail-closed signal: any parse failure of an APPROVED rule must escalate the
// resolution to T3 (never silently skipped).
func EvaluateExpression(expr string, ctx *EvalContext) (bool, error) {
	r, err := ParseRule(expr)
	if err != nil {
		return false, err
	}
	return r.Eval(ctx), nil
}

// ─── Lexer ───────────────────────────────────────────────────────────────────

func isRuleWordChar(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9') || c == '_' || c == ':'
}

func lexRule(s string) ([]string, error) {
	var toks []string
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
		case c == '(' || c == ')':
			toks = append(toks, string(c))
			i++
		case c == '<' || c == '>':
			if i+1 < len(s) && s[i+1] == '=' {
				toks = append(toks, string(c)+"=")
				i += 2
			} else {
				toks = append(toks, string(c))
				i++
			}
		case c == '=':
			toks = append(toks, "=")
			i++
		case isRuleWordChar(c):
			j := i
			for j < len(s) && isRuleWordChar(s[j]) {
				j++
			}
			toks = append(toks, s[i:j])
			i = j
		default:
			return nil, fmt.Errorf("symptomsearch: unexpected character %q in rule expression", string(c))
		}
	}
	return toks, nil
}

// ─── Parser (recursive descent; precedence NOT > AND > OR) ───────────────────

type ruleParser struct {
	toks []string
	pos  int
}

func (p *ruleParser) peek() string {
	if p.pos >= len(p.toks) {
		return ""
	}
	return p.toks[p.pos]
}

func (p *ruleParser) next() string {
	t := p.peek()
	if t != "" {
		p.pos++
	}
	return t
}

func (p *ruleParser) parseOr() (ruleNode, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.peek() == "OR" {
		p.next()
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = orNode{left: left, right: right}
	}
	return left, nil
}

func (p *ruleParser) parseAnd() (ruleNode, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for p.peek() == "AND" {
		p.next()
		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		left = andNode{left: left, right: right}
	}
	return left, nil
}

func (p *ruleParser) parseUnary() (ruleNode, error) {
	if p.peek() == "NOT" {
		p.next()
		inner, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return notNode{inner: inner}, nil
	}
	return p.parsePrimary()
}

var comparators = map[string]bool{"<": true, "<=": true, "=": true, ">=": true, ">": true}

func (p *ruleParser) parsePrimary() (ruleNode, error) {
	tok := p.next()
	switch {
	case tok == "":
		return nil, fmt.Errorf("symptomsearch: unexpected end of rule expression")
	case tok == "(":
		inner, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if p.next() != ")" {
			return nil, fmt.Errorf("symptomsearch: missing closing parenthesis")
		}
		return inner, nil
	case tok == ")" || tok == "AND" || tok == "OR" || tok == "NOT" || comparators[tok]:
		return nil, fmt.Errorf("symptomsearch: unexpected token %q", tok)
	case strings.HasPrefix(tok, "concept:"):
		code := strings.TrimPrefix(tok, "concept:")
		if !isValidConceptCode(code) {
			return nil, fmt.Errorf("symptomsearch: invalid concept code %q", code)
		}
		return conceptNode{code: code}, nil
	case strings.HasPrefix(tok, "who:"):
		cohort := strings.TrimPrefix(tok, "who:")
		if !ValidCohorts[cohort] {
			return nil, fmt.Errorf("symptomsearch: unknown cohort %q", cohort)
		}
		return whoNode{cohort: cohort}, nil
	case tok == "duration_days" || tok == "term_count":
		op := p.next()
		if !comparators[op] {
			return nil, fmt.Errorf("symptomsearch: expected comparator after %q, got %q", tok, op)
		}
		raw := p.next()
		val, err := strconv.Atoi(raw)
		if err != nil || val < 0 {
			return nil, fmt.Errorf("symptomsearch: expected non-negative integer after %q %s, got %q", tok, op, raw)
		}
		return cmpNode{field: tok, op: op, value: val}, nil
	default:
		return nil, fmt.Errorf("symptomsearch: unknown predicate %q", tok)
	}
}

// isValidConceptCode enforces CODE := [a-z][a-z0-9_]* (case-sensitive).
func isValidConceptCode(code string) bool {
	if code == "" {
		return false
	}
	if code[0] < 'a' || code[0] > 'z' {
		return false
	}
	for i := 1; i < len(code); i++ {
		c := code[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '_' {
			return false
		}
	}
	return true
}
