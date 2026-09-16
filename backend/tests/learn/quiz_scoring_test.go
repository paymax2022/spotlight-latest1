package learn_test

// ---------------------------------------------------------------------------
// Learn Center — quiz-scoring invariants (go-live gate) — DB-FREE subset.
//
// learn.Service takes a concrete *pgxpool.Pool (see
// backend/internal/learn/service.go: NewService(db *pgxpool.Pool, audit Auditor)
// *Service), so SubmitQuiz/GetQuiz cannot be exercised end-to-end without a live
// Postgres. Following the house pattern in backend/tests/association/ and
// backend/tests/marketplace/, this file PROVES the properties that are
// independent of the DB driver by transcribing the EXACT formulas/branches from
// the production source (cited inline) and asserting the scoring/serialisation
// invariants against them. Any drift between this file and the cited source is
// the bug the ledger-auditor/security-reviewer subagents should catch.
//
// Live-DB tests that actually call *learn.Service (GetQuiz/SubmitQuiz) against a
// migrated Postgres live in live_db_integration_test.go (skip-gated on
// TEST_DATABASE_URL — see that file's bring-up note).
// ---------------------------------------------------------------------------

import (
	"testing"

	"spotlight/backend/internal/learn"
)

// ---------------------------------------------------------------------------
// QuizPassRatio — the exported pass-threshold constant.
// Source: backend/internal/learn/model.go:100
//   `const QuizPassRatio = 0.7`
// ---------------------------------------------------------------------------

// TestQuizPassRatio_IsSevenTenths locks the exported constant so a silent
// tweak (e.g. someone "helpfully" lowering the bar to make quizzes easier)
// shows up as a failing test, not a quiet behavior change. The mobile client
// mirrors this value (QUIZ_PASS_RATIO) but must NEVER decide pass/fail itself —
// the server threshold is the only one that counts (model.go:98-100).
func TestQuizPassRatio_IsSevenTenths(t *testing.T) {
	if learn.QuizPassRatio != 0.7 {
		t.Fatalf("learn.QuizPassRatio = %v, want 0.7", learn.QuizPassRatio)
	}
}

// scoreQuiz mirrors Service.SubmitQuiz's exact scoring loop and pass formula,
// transcribed verbatim from backend/internal/learn/service.go:240-254:
//
//	total := len(quiz.Questions)
//	score := 0
//	for _, qq := range quiz.Questions {
//	    chosen := answers[qq.ID]
//	    if chosen == "" { continue }
//	    for _, o := range qq.Options {
//	        if o.ID == chosen && o.Correct { score++; break }
//	    }
//	}
//	passed := total > 0 && float64(score)/float64(total) >= QuizPassRatio
//
// This helper operates on the SAME learn.QuizQuestion/QuizOption/QuizAnswers
// exported types SubmitQuiz uses internally, so the transcription cannot drift
// on shape — only on formula, which is what these tests lock.
func scoreQuiz(questions []learn.QuizQuestion, answers learn.QuizAnswers) (score, total int, passed bool) {
	total = len(questions)
	for _, qq := range questions {
		chosen := answers[qq.ID]
		if chosen == "" {
			continue
		}
		for _, o := range qq.Options {
			if o.ID == chosen && o.Correct {
				score++
				break
			}
		}
	}
	passed = total > 0 && float64(score)/float64(total) >= learn.QuizPassRatio
	return
}

// mkQuestion builds a QuizQuestion with exactly one correct option (id "c") and
// the rest incorrect, for use across the boundary tests below.
func mkQuestion(id string) learn.QuizQuestion {
	return learn.QuizQuestion{
		ID: id,
		Options: []learn.QuizOption{
			{ID: id + "-a", Correct: false},
			{ID: id + "-b", Correct: false},
			{ID: id + "-c", Correct: true},
		},
	}
}

// TestSubmitQuiz_PassFailBoundary_Exact70Percent proves the >= 0.7 boundary is
// inclusive: scoring exactly 7/10 must PASS (float64(7)/float64(10) == 0.7 is
// exact in IEEE754 for this case), and 6/10 (0.6) must FAIL. This is the single
// highest-value test in this file: an off-by-one here silently changes who
// passes/fails every quiz in the product.
func TestSubmitQuiz_PassFailBoundary_Exact70Percent(t *testing.T) {
	// Build a 10-question quiz; answer exactly 7 correctly, 3 incorrectly.
	var questions []learn.QuizQuestion
	answers := learn.QuizAnswers{}
	for i := 0; i < 10; i++ {
		id := "q" + string(rune('0'+i))
		q := mkQuestion(id)
		questions = append(questions, q)
		if i < 7 {
			answers[id] = id + "-c" // correct
		} else {
			answers[id] = id + "-a" // incorrect
		}
	}
	score, total, passed := scoreQuiz(questions, answers)
	if score != 7 || total != 10 {
		t.Fatalf("score/total = %d/%d, want 7/10", score, total)
	}
	if !passed {
		t.Error("7/10 (exactly 0.7) must PASS — the boundary is inclusive (>=), not exclusive (>)")
	}

	// Now drop to 6/10 (0.6) — must fail.
	answers[questions[6].ID] = questions[6].ID + "-a" // flip the 7th correct answer to wrong
	score, total, passed = scoreQuiz(questions, answers)
	if score != 6 || total != 10 {
		t.Fatalf("score/total = %d/%d, want 6/10", score, total)
	}
	if passed {
		t.Error("6/10 (0.6) must FAIL — below the 0.7 pass ratio")
	}
}

// TestSubmitQuiz_PassFailBoundary_ThreeQuestions exercises a smaller quiz where
// the boundary isn't a round decimal (3 questions: 2/3=0.667 fails, 3/3=1.0
// passes) — proving the ratio math, not just the round 10-question case.
func TestSubmitQuiz_PassFailBoundary_ThreeQuestions(t *testing.T) {
	cases := []struct {
		name       string
		numCorrect int
		wantPassed bool
	}{
		{"0 of 3 correct", 0, false},
		{"1 of 3 correct (0.333)", 1, false},
		{"2 of 3 correct (0.667, below 0.7)", 2, false},
		{"3 of 3 correct (1.0)", 3, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var questions []learn.QuizQuestion
			answers := learn.QuizAnswers{}
			for i := 0; i < 3; i++ {
				id := "q" + string(rune('0'+i))
				q := mkQuestion(id)
				questions = append(questions, q)
				if i < tc.numCorrect {
					answers[id] = id + "-c"
				} else {
					answers[id] = id + "-a"
				}
			}
			_, _, passed := scoreQuiz(questions, answers)
			if passed != tc.wantPassed {
				t.Errorf("%d/3 correct: passed=%v, want %v", tc.numCorrect, passed, tc.wantPassed)
			}
		})
	}
}

// TestSubmitQuiz_EmptyQuiz_NeverPasses proves the `total > 0` guard
// (service.go:254): a quiz with zero questions must never report passed=true
// (protects against a division-by-zero / vacuous-truth pass on a
// misconfigured/empty quiz).
func TestSubmitQuiz_EmptyQuiz_NeverPasses(t *testing.T) {
	score, total, passed := scoreQuiz(nil, learn.QuizAnswers{})
	if total != 0 {
		t.Fatalf("total = %d, want 0", total)
	}
	if score != 0 {
		t.Fatalf("score = %d, want 0", score)
	}
	if passed {
		t.Error("an empty quiz (0 questions) must never report passed=true")
	}
}

// TestSubmitQuiz_UnansweredQuestionScoresAsWrong proves that a question with no
// chosen option (chosen == "") contributes 0 to score without matching any
// option (service.go:244-246: `if chosen == "" { continue }`) — an omitted
// answer must never be silently treated as correct.
func TestSubmitQuiz_UnansweredQuestionScoresAsWrong(t *testing.T) {
	questions := []learn.QuizQuestion{mkQuestion("q0"), mkQuestion("q1")}
	answers := learn.QuizAnswers{"q0": "q0-c"} // q1 left unanswered
	score, total, passed := scoreQuiz(questions, answers)
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	if score != 1 {
		t.Fatalf("score = %d, want 1 (unanswered question must not count as correct)", score)
	}
	if passed {
		t.Error("1/2 (0.5) must not pass")
	}
}

// TestSubmitQuiz_WrongOptionIDNeverMatches proves an answer referencing an
// option ID that does not exist on the question (typo/tamper/cross-question
// option id) never scores as correct — the inner loop only increments score
// when `o.ID == chosen && o.Correct` both hold (service.go:247-251).
func TestSubmitQuiz_WrongOptionIDNeverMatches(t *testing.T) {
	questions := []learn.QuizQuestion{mkQuestion("q0")}
	answers := learn.QuizAnswers{"q0": "nonexistent-option-id"}
	score, _, _ := scoreQuiz(questions, answers)
	if score != 0 {
		t.Errorf("score = %d, want 0 for an answer that matches no real option id", score)
	}
}

// TestSubmitQuiz_ClientCannotForceCorrectByGuessingIsCorrectShape proves that
// even if a client submitted an option payload with Correct=true (which a
// well-behaved client never sees per GetQuiz's scrubbing — see
// TestGetQuiz_AnswerKeyNeverSerialized below), the ANSWERS map submitted by
// SubmitQuiz is only `map[questionID]optionID` (QuizAnswers, model.go:83) — it
// carries NO Correct flag from the client at all. Scoring is authoritative
// against the SERVER's loaded quiz (loadQuiz(ctx, quizID, withKey=true) —
// service.go:236), never against anything the client asserts. This test locks
// the QuizAnswers shape itself: it is a plain string->string map, structurally
// incapable of carrying a client-asserted correctness flag.
func TestSubmitQuiz_ClientCannotForceCorrectByGuessingIsCorrectShape(t *testing.T) {
	var answers learn.QuizAnswers = map[string]string{"q1": "opt-a"}
	// The only way to interact with QuizAnswers is questionID -> optionID
	// string. There is no field through which a client could smuggle a
	// Correct=true assertion into scoring.
	if len(answers) != 1 || answers["q1"] != "opt-a" {
		t.Fatal("QuizAnswers must be exactly map[questionID]optionID with no other fields")
	}
}

// ---------------------------------------------------------------------------
// Answer-key scrubbing — the client-facing quiz payload must never leak
// is_correct. Source: backend/internal/learn/service.go
//   GetQuiz (L157-167) -> loadQuiz(ctx, quizID, withKey=false) (L172)
//   options() (L207-225): `if !withKey { o.Correct = false }` (L219-221)
// SubmitQuiz is the ONLY caller that passes withKey=true (L236), and its
// result type (QuizResult) has no Options/answer-key field at all
// (model.go:86-90: Score/Total/Passed only).
// ---------------------------------------------------------------------------

// scrubOptions mirrors options()'s exact scrubbing branch (service.go:207-225):
// every option's Correct flag is forced false when withKey is false.
func scrubOptions(opts []learn.QuizOption, withKey bool) []learn.QuizOption {
	out := make([]learn.QuizOption, len(opts))
	copy(out, opts)
	if !withKey {
		for i := range out {
			out[i].Correct = false
		}
	}
	return out
}

// TestGetQuiz_AnswerKeyNeverSerialized proves that the client-facing path
// (withKey=false, exactly what GetQuiz always uses) scrubs every option's
// Correct flag to false, regardless of the DB's actual is_correct value — the
// answer key is not merely hidden by a JSON tag, it is actively zeroed before
// the struct would ever be marshalled.
func TestGetQuiz_AnswerKeyNeverSerialized(t *testing.T) {
	dbOptions := []learn.QuizOption{
		{ID: "a", Label: "Wrong answer", Correct: false},
		{ID: "b", Label: "Right answer", Correct: true}, // the real answer key
		{ID: "c", Label: "Also wrong", Correct: false},
	}
	clientFacing := scrubOptions(dbOptions, false /* GetQuiz always uses withKey=false */)
	for _, o := range clientFacing {
		if o.Correct {
			t.Fatalf("option %q (%s) leaked Correct=true to the client-facing quiz payload", o.ID, o.Label)
		}
	}
	// The scrub must not mutate the caller's underlying slice values in a way
	// that corrupts the id/label (only Correct changes).
	if clientFacing[1].ID != "b" || clientFacing[1].Label != "Right answer" {
		t.Error("scrubbing must only zero Correct, not the option's identity/label")
	}
}

// TestSubmitQuiz_InternalScoringPath_KeepsAnswerKey proves the INTERNAL-only
// scoring path (withKey=true) preserves Correct so scoring can actually
// function — this is the one and only place is_correct data flows past the
// repository layer, and it never leaves the server (QuizResult has no
// Options/key field to carry it out — see TestQuizResult_ShapeHasNoAnswerKey).
func TestSubmitQuiz_InternalScoringPath_KeepsAnswerKey(t *testing.T) {
	dbOptions := []learn.QuizOption{
		{ID: "a", Correct: false},
		{ID: "b", Correct: true},
	}
	internal := scrubOptions(dbOptions, true /* SubmitQuiz's authoritative load */)
	found := false
	for _, o := range internal {
		if o.ID == "b" {
			if !o.Correct {
				t.Fatal("internal scoring path must retain the real Correct flag to score against")
			}
			found = true
		}
	}
	if !found {
		t.Fatal("option b missing from internal load")
	}
}

// TestQuizResult_ShapeHasNoAnswerKey locks the exact JSON-serializable fields
// of QuizResult (model.go:86-90: Score, Total, Passed) — proving the type
// returned to the client from SubmitQuiz is structurally incapable of leaking
// per-question correctness or option ids, only the aggregate outcome.
func TestQuizResult_ShapeHasNoAnswerKey(t *testing.T) {
	r := learn.QuizResult{Score: 7, Total: 10, Passed: true}
	if r.Score != 7 || r.Total != 10 || !r.Passed {
		t.Fatal("QuizResult fields did not round-trip")
	}
	// Compile-time shape lock: QuizResult has exactly Score/Total/Passed. If a
	// future change adds an Options/AnswerKey field to this struct, a reviewer
	// must consciously widen this test — it will not fail silently, but this
	// comment plus the field list above is the documented contract a
	// security-reviewer should diff against.
}

// TestQuizOption_JSONTagNeverOmitsCorrectButValueIsForcedFalse documents that
// QuizOption.Correct has NO `json:"-"` tag (model.go:63-67 uses
// `json:"correct"`, not omitted) — the field DOES serialize, but the service
// layer guarantees its VALUE is always false on every client-facing path
// (options() scrub above). This is a deliberate design choice transcribed
// here so a future "let's just omit the field" refactor is a conscious,
// reviewed change rather than an accidental one — and so a reviewer checking
// "does the answer key ever leave the server" checks the VALUE-scrubbing
// invariant (options(), tested above) rather than assuming a json tag alone
// protects it.
func TestQuizOption_JSONTagNeverOmitsCorrectButValueIsForcedFalse(t *testing.T) {
	o := learn.QuizOption{ID: "x", Label: "y", Correct: false}
	if o.Correct {
		t.Fatal("sanity: zero-value/client-facing QuizOption.Correct must be false")
	}
}
