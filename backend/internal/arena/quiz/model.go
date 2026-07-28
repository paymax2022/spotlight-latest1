// Package quiz integrates the Naija Driver 90-question quiz bank into the Arena
// module. It feeds BOTH the public "Play-Along" quiz rail AND the proctored
// Theory exam over a SINGLE shared question bank, keeping the new logic out of the
// existing arena/service files to minimise churn.
//
// Merit firewall (NDC-1): Play-Along scoring writes ONLY arena_quiz_attempt +
// delegates engagement/credential/cashback to the existing PlayAlongService — it
// holds NO signer and NEVER writes arena_merit_entry. Exam submit records the
// attempt and advances the contestant lifecycle but mints NO merit; exam merit is
// minted ONLY at proctor attestation through the signed TheoryExamAdapter (NDC-2).
package quiz

const (
	// DefaultBankKey is the seeded Naija Driver quiz bank identifier.
	DefaultBankKey = "naija_driver_safe_driving_assessment"
	// DefaultRubricVersion is the seeded rubric version for that bank.
	DefaultRubricVersion = "naija_driver_v1.0.0"
	// DefaultTimeLimitSeconds is the per-question timer (120s per PRD).
	DefaultTimeLimitSeconds = 120

	// ModePlayAlong is the public engagement quiz mode.
	ModePlayAlong = "PLAYALONG"
	// ModeTheoryExam is the proctored contestant exam mode.
	ModeTheoryExam = "THEORY_EXAM"
)

// Question is one persisted bank question (admin/full view). JSON is camelCase to
// match the rest of the arena API surface (StageView/QuestionView) and the admin
// console client (frontend-admin/src/types/arenaAdmin.ts).
type Question struct {
	ID              string   `json:"id"`            // uuid pk
	CompetitionID   string   `json:"competitionId"` // "" for template-bank rows
	BankKey         string   `json:"bankKey"`
	RubricVersion   string   `json:"rubricVersion"`
	ExternalID      string   `json:"externalId"` // e.g. ND-S1-Q01 (the public question id)
	Stage           int      `json:"stage"`      // 1|2|3
	Category        string   `json:"category"`
	Prompt          string   `json:"prompt"`
	Options         []string `json:"options"`      // exactly 4
	CorrectIndex    int      `json:"correctIndex"` // 0..3 (admin-only)
	CorrectAnswer   string   `json:"correctAnswer"`// admin-only
	Explanation     string   `json:"explanation"`  // admin-only (revealed post-answer)
	TimeLimitSecs   int      `json:"timeLimitSeconds"`
	PassMarkPercent int      `json:"passMarkPercent"`
}

// QuestionCounts is the admin list count bundle (matches the admin client's
// expected {total, perStage[], perCategory[]} shape).
type QuestionCounts struct {
	Total       int              `json:"total"`
	PerStage    []StageBucket    `json:"perStage"`
	PerCategory []CategoryBucket `json:"perCategory"`
}

// StageBucket is a per-stage question count.
type StageBucket struct {
	Stage int `json:"stage"`
	Count int `json:"count"`
}

// CategoryBucket is a per-category question count.
type CategoryBucket struct {
	Category string `json:"category"`
	Count    int    `json:"count"`
}

// CountQuestions builds the admin QuestionCounts bundle from a question slice.
func CountQuestions(qs []Question) QuestionCounts {
	byStage := map[int]int{}
	byCat := map[string]int{}
	stageOrder := []int{}
	catOrder := []string{}
	for _, q := range qs {
		if _, ok := byStage[q.Stage]; !ok {
			stageOrder = append(stageOrder, q.Stage)
		}
		if _, ok := byCat[q.Category]; !ok {
			catOrder = append(catOrder, q.Category)
		}
		byStage[q.Stage]++
		byCat[q.Category]++
	}
	out := QuestionCounts{Total: len(qs)}
	for _, s := range stageOrder {
		out.PerStage = append(out.PerStage, StageBucket{Stage: s, Count: byStage[s]})
	}
	for _, cat := range catOrder {
		out.PerCategory = append(out.PerCategory, CategoryBucket{Category: cat, Count: byCat[cat]})
	}
	return out
}

// OptionView is a contestant-safe option (id "0".."3" + label).
type OptionView struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// QuestionView is the contestant-safe projection: NO correct index / answer /
// explanation. This is what the Play-Along rail and the exam runner receive.
type QuestionView struct {
	ID            string       `json:"id"` // external_id (public handle)
	Category      string       `json:"category"`
	Prompt        string       `json:"prompt"`
	Options       []OptionView `json:"options"`
	TimeLimitSecs int          `json:"timeLimitSecs"`
}

// StageView is the contestant-safe stage envelope for the Play-Along / exam pull.
type StageView struct {
	StageNumber     int            `json:"stageNumber"`
	StageName       string         `json:"stageName"`
	PassMarkPercent int            `json:"passMarkPercent"`
	TimeLimitSecs   int            `json:"timeLimitSecs"`
	Questions       []QuestionView `json:"questions"`
}

// Answer is one submitted response (question external id + chosen option index).
type Answer struct {
	QuestionID string `json:"questionId"` // external_id
	OptionID   string `json:"optionId"`   // "0".."3"
}

// Response is one persisted, marked response inside an attempt.
type Response struct {
	QuestionExternalID string `json:"question_external_id"`
	OptionIndex        int    `json:"option_index"`
	Correct            bool   `json:"correct"`
}

// Reveal is the per-question teaching-moment payload returned after a Play-Along
// attempt (correct option + explanation + whether the taker got it right).
type Reveal struct {
	QuestionID       string `json:"questionId"`       // external_id
	CorrectOptionID  string `json:"correctOptionId"`  // "0".."3"
	Explanation      string `json:"explanation"`
	Correct          bool   `json:"correct"`
}

// PlayAlongResult merges local scoring with the engagement rail's outcome.
type PlayAlongResult struct {
	Score          int      `json:"score"`
	Total          int      `json:"total"`
	Passed         bool     `json:"passed"`
	PerQuestion    []Reveal `json:"perQuestion"`
	CredentialIssued bool   `json:"credentialIssued"`
	CredentialHash string   `json:"credentialHash,omitempty"`
	CashbackKobo   int64    `json:"cashbackKobo,omitempty"`
}

// ExamResult is the exam-submit outcome (no merit — see NDC-2).
type ExamResult struct {
	OK    bool   `json:"ok"`
	State string `json:"state"`
}

// StageStat is a per-stage admin count bundle.
type StageStat struct {
	Stage         int     `json:"stage"`
	QuestionCount int     `json:"questionCount"`
	AttemptCount  int     `json:"attemptCount"`
	PassRate      float64 `json:"passRate"`
}
