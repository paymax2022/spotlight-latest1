package quiz

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

// fullBankRow is one admin-view question carrying the answer fields that MUST be
// stripped from any contestant-facing projection.
func fullBankRow(ext string, stage, correct, passMark int) Question {
	return Question{
		ID:              "uuid-" + ext,
		CompetitionID:   "comp-1",
		BankKey:         DefaultBankKey,
		RubricVersion:   DefaultRubricVersion,
		ExternalID:      ext,
		Stage:           stage,
		Category:        "road_signs",
		Prompt:          "What shape is a warning sign?",
		Options:         []string{"Rectangular", "Triangular", "Circular", "Octagonal"},
		CorrectIndex:    correct,
		CorrectAnswer:   "Triangular",
		Explanation:     "Triangular signs warn of hazards ahead.",
		TimeLimitSecs:   DefaultTimeLimitSeconds,
		PassMarkPercent: passMark,
	}
}

// TestContestantView_StripsAnswerFields proves the contestant-safe projection
// carries NO correct index / correct answer / explanation, and that option ids
// are the string indices "0".."3" with labels preserved.
func TestContestantView_StripsAnswerFields(t *testing.T) {
	full := []Question{
		fullBankRow("ND-S1-Q01", 1, 1, 70),
		fullBankRow("ND-S1-Q02", 1, 3, 70),
	}
	views := ContestantView(full)
	if len(views) != len(full) {
		t.Fatalf("view count = %d, want %d", len(views), len(full))
	}

	// The QuestionView type has NO field for the correct index/answer/explanation
	// (compile-time firewall). Marshal to JSON and assert those keys never appear.
	blob, err := json.Marshal(views)
	if err != nil {
		t.Fatalf("marshal views: %v", err)
	}
	js := string(blob)
	for _, leak := range []string{"correct_index", "correctIndex", "correct_answer", "correctAnswer", "explanation", "Triangular"} {
		// "Triangular" is the correct_answer text and also an option label, so only
		// assert the answer-only keys; option labels legitimately include it.
		if leak == "Triangular" {
			continue
		}
		if strings.Contains(js, leak) {
			t.Fatalf("contestant view leaked answer field %q: %s", leak, js)
		}
	}

	for i, v := range views {
		if v.ID != full[i].ExternalID {
			t.Fatalf("view %d id = %s, want external id %s", i, v.ID, full[i].ExternalID)
		}
		if len(v.Options) != 4 {
			t.Fatalf("view %d must expose exactly 4 options", i)
		}
		for j, opt := range v.Options {
			if opt.ID != strconv.Itoa(j) {
				t.Fatalf("option %d id = %s, want %d", j, opt.ID, j)
			}
			if opt.Label != full[i].Options[j] {
				t.Fatalf("option %d label = %s, want %s", j, opt.Label, full[i].Options[j])
			}
		}
		if v.Category != full[i].Category || v.Prompt != full[i].Prompt {
			t.Fatalf("view %d must preserve category/prompt", i)
		}
		if v.TimeLimitSecs != full[i].TimeLimitSecs {
			t.Fatalf("view %d must preserve time limit", i)
		}
	}
}

// TestQuestionView_HasNoOptionCorrectness proves the contestant-safe OptionView
// carries only id+label — no per-option "correct" boolean.
func TestQuestionView_HasNoOptionCorrectness(t *testing.T) {
	views := ContestantView([]Question{fullBankRow("ND-S2-Q01", 2, 0, 75)})
	blob, _ := json.Marshal(views[0].Options[0])
	if strings.Contains(strings.ToLower(string(blob)), "correct") {
		t.Fatalf("OptionView must not carry any correctness flag: %s", blob)
	}
}

// TestStageView_Shape asserts the contestant-safe stage envelope exposes the
// stage metadata + contestant-safe questions and never the answer fields.
func TestStageView_Shape(t *testing.T) {
	full := []Question{
		fullBankRow("ND-S3-Q01", 3, 3, 80),
		fullBankRow("ND-S3-Q02", 3, 0, 80),
	}
	sv := StageView{
		StageNumber:     3,
		StageName:       stageName(3),
		PassMarkPercent: full[0].PassMarkPercent,
		TimeLimitSecs:   full[0].TimeLimitSecs,
		Questions:       ContestantView(full),
	}
	if sv.PassMarkPercent != 80 {
		t.Fatalf("stage 3 pass mark = %d, want 80", sv.PassMarkPercent)
	}
	if sv.StageName == "" {
		t.Fatal("stage name must be populated")
	}
	blob, _ := json.Marshal(sv)
	for _, leak := range []string{"correct_index", "correct_answer", "explanation"} {
		if strings.Contains(string(blob), leak) {
			t.Fatalf("StageView leaked answer field %q: %s", leak, blob)
		}
	}
}

// TestStageName_MapsAllStages guards the stage-name lookup used by StageView.
func TestStageName_MapsAllStages(t *testing.T) {
	for _, st := range []int{1, 2, 3} {
		if stageName(st) == "" {
			t.Fatalf("stage %d must have a name", st)
		}
	}
	if stageName(9) != "" {
		t.Fatal("unknown stage must map to empty name")
	}
}

// TestBatchToStage_And_StageToTheoryStage guards the batch↔stage mapping the exam
// path relies on (B1→1→THEORY_B1, etc.) including the unknown-batch fail case.
func TestBatchToStage_And_StageToTheoryStage(t *testing.T) {
	cases := map[string]int{"B1": 1, "b1": 1, " B2 ": 2, "B3": 3, "": 0, "X": 0}
	for batch, want := range cases {
		if got := batchToStage(batch); got != want {
			t.Fatalf("batchToStage(%q) = %d, want %d", batch, got, want)
		}
	}
	if StageToTheoryStage(1) != "THEORY_B1" || StageToTheoryStage(2) != "THEORY_B2" || StageToTheoryStage(3) != "THEORY_B3" {
		t.Fatal("StageToTheoryStage must map 1/2/3 → THEORY_B1/B2/B3")
	}
	// Unknown quiz stage falls back to SCREENING (a theory-supported stage) — not empty.
	if StageToTheoryStage(9) != "SCREENING" {
		t.Fatalf("StageToTheoryStage(9) = %q, want SCREENING fallback", StageToTheoryStage(9))
	}
}
