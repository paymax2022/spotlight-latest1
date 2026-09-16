// Package placement builds and scores the curriculum-grounded onboarding
// placement quiz. It composes the curriculum tables (class → core subjects) with
// the assessment question bank (academy_question_items, status='approved') and
// produces a per-subject placement snapshot for the learner's selected class.
//
// No new tables — it reads the existing curriculum + question bank. The quiz it
// returns never includes the answer key; scoring happens server-side.
package placement

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// VersionCode is the curriculum version the placement quiz draws from.
const VersionCode = "NERDC-2025"

// Placement level bands (fraction correct per subject).
const (
	belowTrack = 0.40
	aboveTrack = 0.75
)

type Option struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// PlacementQuestion is a quiz question WITHOUT the answer key.
type PlacementQuestion struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`
	Stem        string   `json:"stem"`
	Options     []Option `json:"options"`
	SubjectCode string   `json:"subject_code"`
	SubjectName string   `json:"subject_name"`
}

type PlacementQuiz struct {
	ClassCode string              `json:"class_code"`
	Questions []PlacementQuestion `json:"questions"`
}

type Answer struct {
	QuestionID string   `json:"question_id"`
	Selected   []string `json:"selected"`
}

type SubjectScore struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Correct  int     `json:"correct"`
	Total    int     `json:"total"`
	ScorePct float64 `json:"score_pct"`
	Level    string  `json:"level"` // below_track | on_track | above_track
}

type PlacementResult struct {
	ClassCode  string         `json:"class_code"`
	OverallPct float64        `json:"overall_pct"`
	Subjects   []SubjectScore `json:"subjects"`
}

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

func level(pct float64) string {
	switch {
	case pct < belowTrack:
		return "below_track"
	case pct >= aboveTrack:
		return "above_track"
	default:
		return "on_track"
	}
}

// BuildQuiz assembles up to perSubject approved questions for each CORE subject
// of the class (by NERDC-2025 version), grouped by subject and stripped of answers.
func (s *Service) BuildQuiz(ctx context.Context, classCode string, perSubject int) (*PlacementQuiz, error) {
	if perSubject <= 0 {
		perSubject = 2
	}
	const q = `
		SELECT ranked.id, ranked.type, ranked.stem, ranked.options, ranked.scode, ranked.sname
		FROM (
			SELECT qi.id, qi.type, qi.stem, qi.options, s.code AS scode, s.name AS sname,
			       row_number() OVER (PARTITION BY s.id ORDER BY qi.difficulty, qi.created_at) AS rn
			FROM academy_question_items qi
			JOIN academy_subjects s              ON s.id = qi.subject_id
			JOIN academy_classes c               ON c.id = s.class_id
			JOIN academy_curriculum_versions v   ON v.id = c.version_id AND v.code = $1
			WHERE c.code = $2 AND s.kind = 'core' AND qi.status = 'approved'
		) ranked
		WHERE ranked.rn <= $3
		ORDER BY ranked.scode, ranked.rn`
	rows, err := s.db.Query(ctx, q, VersionCode, classCode, perSubject)
	if err != nil {
		return nil, fmt.Errorf("placement: build quiz: %w", err)
	}
	defer rows.Close()
	out := &PlacementQuiz{ClassCode: classCode, Questions: []PlacementQuestion{}}
	for rows.Next() {
		var pq PlacementQuestion
		var opts []Option
		if err := rows.Scan(&pq.ID, &pq.Type, &pq.Stem, &opts, &pq.SubjectCode, &pq.SubjectName); err != nil {
			return nil, err
		}
		pq.Options = opts
		out.Questions = append(out.Questions, pq)
	}
	return out, rows.Err()
}

// Score marks the submitted answers against the approved item answer keys and
// aggregates a per-subject placement. A question is correct only when the selected
// option set exactly matches the item's correct set. userID is reserved for a
// future progress/mastery write; the diagnostic itself moves no state today.
func (s *Service) Score(ctx context.Context, userID, classCode string, answers []Answer) (*PlacementResult, error) {
	selByQ := make(map[string]map[string]bool, len(answers))
	ids := make([]string, 0, len(answers))
	for _, a := range answers {
		set := make(map[string]bool, len(a.Selected))
		for _, s := range a.Selected {
			set[s] = true
		}
		selByQ[a.QuestionID] = set
		ids = append(ids, a.QuestionID)
	}

	type agg struct {
		name             string
		correct, total   int
	}
	bySubject := map[string]*agg{}

	const q = `
		SELECT qi.id, qi.answer, s.code, s.name
		FROM academy_question_items qi
		JOIN academy_subjects s ON s.id = qi.subject_id
		WHERE qi.id = ANY($1) AND qi.status = 'approved'`
	rows, err := s.db.Query(ctx, q, ids)
	if err != nil {
		return nil, fmt.Errorf("placement: score: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var qid, scode, sname string
		var answer map[string]any
		if err := rows.Scan(&qid, &answer, &scode, &sname); err != nil {
			return nil, err
		}
		a := bySubject[scode]
		if a == nil {
			a = &agg{name: sname}
			bySubject[scode] = a
		}
		a.total++
		if setsEqual(selByQ[qid], correctSet(answer)) {
			a.correct++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	res := &PlacementResult{ClassCode: classCode, Subjects: []SubjectScore{}}
	var totCorrect, totAll int
	for code, a := range bySubject {
		pct := 0.0
		if a.total > 0 {
			pct = float64(a.correct) / float64(a.total)
		}
		res.Subjects = append(res.Subjects, SubjectScore{
			Code: code, Name: a.name, Correct: a.correct, Total: a.total, ScorePct: pct, Level: level(pct),
		})
		totCorrect += a.correct
		totAll += a.total
	}
	if totAll > 0 {
		res.OverallPct = float64(totCorrect) / float64(totAll)
	}
	sortSubjects(res.Subjects)
	return res, nil
}

// (subject aggregation deliberately keeps zero external deps beyond pgx pool)

func correctSet(answer map[string]any) map[string]bool {
	out := map[string]bool{}
	if answer == nil {
		return out
	}
	raw, ok := answer["correct"].([]any)
	if !ok {
		return out
	}
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out[s] = true
		}
	}
	return out
}

func setsEqual(a, b map[string]bool) bool {
	if len(a) != len(b) || len(b) == 0 {
		return false
	}
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}

func sortSubjects(ss []SubjectScore) {
	for i := 1; i < len(ss); i++ {
		for j := i; j > 0 && ss[j-1].Code > ss[j].Code; j-- {
			ss[j-1], ss[j] = ss[j], ss[j-1]
		}
	}
}
