package quiz

import (
	"strconv"
	"testing"
)

// ── Test bank builders ───────────────────────────────────────────────────────

// stageBank builds n questions for a stage, all with the given pass mark, whose
// correct option is index (i % 4) so answers can be constructed deterministically.
func stageBank(prefix string, n, passMark int) []Question {
	qs := make([]Question, 0, n)
	for i := 0; i < n; i++ {
		qs = append(qs, Question{
			ExternalID:      prefix + "-Q" + strconv.Itoa(i),
			Stage:           1,
			Category:        "cat",
			Prompt:          "prompt",
			Options:         []string{"a", "b", "c", "d"},
			CorrectIndex:    i % 4,
			Explanation:     "because",
			TimeLimitSecs:   DefaultTimeLimitSeconds,
			PassMarkPercent: passMark,
		})
	}
	return qs
}

// correctAnswers returns the fully-correct answer set for a bank.
func correctAnswers(qs []Question) []Answer {
	out := make([]Answer, 0, len(qs))
	for _, q := range qs {
		out = append(out, Answer{QuestionID: q.ExternalID, OptionID: strconv.Itoa(q.CorrectIndex)})
	}
	return out
}

// firstNCorrect returns answers where the first n questions are answered
// correctly and the rest are answered WRONG (deliberately picking a wrong index).
func firstNCorrect(qs []Question, n int) []Answer {
	out := make([]Answer, 0, len(qs))
	for i, q := range qs {
		opt := q.CorrectIndex
		if i >= n {
			opt = (q.CorrectIndex + 1) % 4 // guaranteed wrong
		}
		out = append(out, Answer{QuestionID: q.ExternalID, OptionID: strconv.Itoa(opt)})
	}
	return out
}

// ── mark(): scoring correctness ──────────────────────────────────────────────

func TestMark_FullyCorrect(t *testing.T) {
	qs := stageBank("ND-S1", 30, 70)
	score, total, reveals, responses := mark(qs, correctAnswers(qs))
	if score != 30 || total != 30 {
		t.Fatalf("full-correct: score/total = %d/%d, want 30/30", score, total)
	}
	if len(reveals) != 30 || len(responses) != 30 {
		t.Fatalf("reveals/responses len = %d/%d, want 30/30", len(reveals), len(responses))
	}
	for i, r := range reveals {
		if !r.Correct {
			t.Fatalf("reveal %d must be Correct on a full-correct run", i)
		}
		// The reveal exposes the correct option (teaching moment).
		if r.CorrectOptionID != strconv.Itoa(qs[i].CorrectIndex) {
			t.Fatalf("reveal %d correctOptionId = %s, want %d", i, r.CorrectOptionID, qs[i].CorrectIndex)
		}
	}
	for i, rp := range responses {
		if !rp.Correct || rp.OptionIndex != qs[i].CorrectIndex {
			t.Fatalf("response %d not recorded correctly: %+v", i, rp)
		}
	}
}

func TestMark_Zero(t *testing.T) {
	qs := stageBank("ND-S1", 30, 70)
	score, total, _, _ := mark(qs, firstNCorrect(qs, 0))
	if score != 0 || total != 30 {
		t.Fatalf("all-wrong: score/total = %d/%d, want 0/30", score, total)
	}
}

func TestMark_UnansweredScoresZero(t *testing.T) {
	qs := stageBank("ND-S1", 30, 70)
	// No answers submitted at all → every question unanswered → 0.
	score, total, _, responses := mark(qs, nil)
	if score != 0 || total != 30 {
		t.Fatalf("unanswered: score/total = %d/%d, want 0/30", score, total)
	}
	// Unanswered questions record OptionIndex = -1 (the "no pick" sentinel) and Correct=false.
	for i, rp := range responses {
		if rp.Correct {
			t.Fatalf("unanswered response %d must be incorrect", i)
		}
		if rp.OptionIndex != -1 {
			t.Fatalf("unanswered response %d OptionIndex = %d, want -1 (sentinel)", i, rp.OptionIndex)
		}
	}
}

func TestMark_UnknownOptionScoresZero(t *testing.T) {
	qs := stageBank("ND-S1", 4, 70)
	// A non-numeric optionId must be treated as "no pick" (-1) → never correct.
	answers := []Answer{
		{QuestionID: qs[0].ExternalID, OptionID: "not-a-number"},
		{QuestionID: qs[1].ExternalID, OptionID: ""},
		{QuestionID: qs[2].ExternalID, OptionID: strconv.Itoa(qs[2].CorrectIndex)}, // correct
		{QuestionID: qs[3].ExternalID, OptionID: "9"},                              // out-of-range but parseable → wrong
	}
	score, total, _, responses := mark(qs, answers)
	if total != 4 || score != 1 {
		t.Fatalf("unknown-option: score/total = %d/%d, want 1/4", score, total)
	}
	if responses[0].OptionIndex != -1 || responses[1].OptionIndex != -1 {
		t.Fatalf("non-numeric/empty optionId must record -1: %+v", responses[:2])
	}
}

func TestMark_IgnoresAnswersForUnknownQuestions(t *testing.T) {
	qs := stageBank("ND-S1", 3, 70)
	// An answer for a question not in the paper must not inflate score or total.
	answers := append(correctAnswers(qs), Answer{QuestionID: "GHOST-Q99", OptionID: "0"})
	score, total, _, responses := mark(qs, answers)
	if total != 3 || score != 3 {
		t.Fatalf("ghost answer: score/total = %d/%d, want 3/3", score, total)
	}
	if len(responses) != 3 {
		t.Fatalf("responses len = %d, want 3 (ghost answer must not create a response)", len(responses))
	}
}

// ── passes(): pass-mark boundary per stage ───────────────────────────────────

// The pass rule is score*100 >= passMark*total (i.e. percentage >= pass mark).
func TestPasses_BoundaryPerStage(t *testing.T) {
	const total = 30
	cases := []struct {
		name     string
		passMark int
		// atMark is the exact integer score whose percentage == pass mark.
		atMark int
	}{
		{"stage1_70pct", 70, 21}, // 21/30 = 70.0%
		{"stage2_75pct", 75, 23}, // 22/30=73.3 (fail), 23/30=76.7 (pass); ceil(0.75*30)=23
		{"stage3_80pct", 80, 24}, // 24/30 = 80.0%
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// At/above the mark → pass.
			if !passes(c.atMark, total, c.passMark) {
				t.Fatalf("%s: score %d/%d must PASS at pass mark %d%%", c.name, c.atMark, total, c.passMark)
			}
			if !passes(total, total, c.passMark) {
				t.Fatalf("%s: full marks must PASS", c.name)
			}
			// Just below the smallest passing score → fail.
			if passes(c.atMark-1, total, c.passMark) {
				t.Fatalf("%s: score %d/%d must FAIL below pass mark %d%%", c.name, c.atMark-1, total, c.passMark)
			}
			// Zero always fails.
			if passes(0, total, c.passMark) {
				t.Fatalf("%s: zero must FAIL", c.name)
			}
		})
	}
}

// Stage-1 exact 70% boundary: 21/30 = 70.0 passes, 20/30 = 66.7 fails.
func TestPasses_Stage1ExactBoundary(t *testing.T) {
	if !passes(21, 30, 70) {
		t.Fatal("21/30 (70.0%) must pass a 70% mark")
	}
	if passes(20, 30, 70) {
		t.Fatal("20/30 (66.7%) must fail a 70% mark")
	}
}

// passes() fails closed when total is zero (no divide, no accidental pass).
func TestPasses_ZeroTotalFailsClosed(t *testing.T) {
	if passes(0, 0, 70) || passes(5, 0, 70) {
		t.Fatal("zero-total must fail closed")
	}
}

// End-to-end through mark()+passes(): a partial score at/above/below the stage
// pass mark yields the right pass/fail decision, mirroring the service path.
func TestScorePath_PartialAtStagePassMarks(t *testing.T) {
	cases := []struct {
		stage    string
		passMark int
		correct  int
		want     bool
	}{
		{"S1", 70, 21, true},  // exactly 70%
		{"S1", 70, 20, false}, // just under
		{"S2", 75, 23, true},  // 76.7% clears 75%
		{"S2", 75, 22, false}, // 73.3% under 75%
		{"S3", 80, 24, true},  // exactly 80%
		{"S3", 80, 23, false}, // 76.7% under 80%
	}
	for _, c := range cases {
		qs := stageBank("ND-"+c.stage, 30, c.passMark)
		score, total, _, _ := mark(qs, firstNCorrect(qs, c.correct))
		if score != c.correct {
			t.Fatalf("%s: mark scored %d, want %d", c.stage, score, c.correct)
		}
		if got := passes(score, total, c.passMark); got != c.want {
			t.Fatalf("%s: %d/%d @%d%% passed=%v, want %v", c.stage, score, total, c.passMark, got, c.want)
		}
	}
}
