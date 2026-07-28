package governance

import (
	"context"

	"spotlight/backend/internal/health/triage"
)

// VignetteStore is the slice of the repository the validation harness needs.
type VignetteStore interface {
	ListVignettes(ctx context.Context) ([]Vignette, error)
	UpsertVignette(ctx context.Context, v *Vignette) (*Vignette, error)
	InsertEvalRun(ctx context.Context, e *EvalRun) error
}

// Report is the shadow-eval outcome. EMERGENCY SENSITIVITY (recall on the
// expected-emergency cases) is the headline, safety-critical metric and is computed
// FIRST (SC-11): missing a true emergency is the worst failure mode, so it leads.
// Over/under-triage and per-language parity follow.
type Report struct {
	TotalVignettes int `json:"total_vignettes"`

	// ── Emergency sensitivity (recall on expected_emergency) — computed FIRST. ──
	EmergencyTotal       int     `json:"emergency_total"`        // # vignettes expecting an emergency
	EmergencyDetected    int     `json:"emergency_detected"`     // # of those the engine flagged emergency
	EmergencyMissed      int     `json:"emergency_missed"`       // FALSE NEGATIVES — the dangerous misses
	EmergencySensitivity float64 `json:"emergency_sensitivity"`  // detected / total (0..1); recall
	EmergencyMissedCodes []string `json:"emergency_missed_codes"` // which vignettes were missed

	// ── Triage accuracy. ──
	LevelMatches int     `json:"level_matches"` // exact disposition-level matches
	OverTriage   int     `json:"over_triage"`   // engine MORE urgent than expected (safe-side)
	UnderTriage  int     `json:"under_triage"`  // engine LESS urgent than expected (risk-side)
	Accuracy     float64 `json:"accuracy"`      // level_matches / total

	// ── Per-language parity (sensitivity + accuracy by language code). ──
	ByLanguage map[string]LanguageReport `json:"by_language"`
}

// LanguageReport is the per-language slice of the report (parity check).
type LanguageReport struct {
	Total                int     `json:"total"`
	LevelMatches         int     `json:"level_matches"`
	Accuracy             float64 `json:"accuracy"`
	EmergencyTotal       int     `json:"emergency_total"`
	EmergencyDetected    int     `json:"emergency_detected"`
	EmergencySensitivity float64 `json:"emergency_sensitivity"`
}

// ValidationService runs the offline/shadow validation harness over the African
// clinical vignette corpus.
type ValidationService struct{ store VignetteStore }

// NewValidationService builds the validation service.
func NewValidationService(store VignetteStore) *ValidationService {
	return &ValidationService{store: store}
}

// isEmergencyLevel reports whether a disposition level is an emergency (1 or 2).
func isEmergencyLevel(level int) bool {
	return level == triage.LevelEmergencyAmbulance || level == triage.LevelEmergencyUrgent
}

// RunShadowEval runs the engine over every vignette and produces a Report. For each
// vignette it triages the de-identified evidence, records an eval_run row
// (level_match + emergency_correct), and aggregates. EMERGENCY SENSITIVITY is
// computed first (SC-11). The engine here is the SAME triage.EngineProvider used in
// production, so this faithfully shadows live behaviour.
func (s *ValidationService) RunShadowEval(ctx context.Context, engine triage.EngineProvider) (Report, error) {
	vigs, err := s.store.ListVignettes(ctx)
	if err != nil {
		return Report{}, err
	}
	rep := Report{
		TotalVignettes:       len(vigs),
		EmergencyMissedCodes: []string{},
		ByLanguage:           map[string]LanguageReport{},
	}

	for i := range vigs {
		v := &vigs[i]
		in := triage.EngineInput{
			AgeYears: v.AgeYears,
			Sex:      v.Sex,
			Region:   v.Region,
			Evidence: v.Evidence,
		}
		res, err := engine.Triage(ctx, in)
		if err != nil {
			return rep, err
		}
		engineLevel := res.Level
		levelMatch := engineLevel == v.ExpectedLevel
		engineEmergency := isEmergencyLevel(engineLevel)

		// emergency_correct: for an emergency vignette, did we flag emergency? For a
		// non-emergency vignette, did we correctly NOT flag emergency?
		emergencyCorrect := engineEmergency == v.ExpectedEmergency

		// Persist the per-vignette observation.
		_ = s.store.InsertEvalRun(ctx, &EvalRun{
			VignetteID:       v.ID,
			EngineLevel:      engineLevel,
			LevelMatch:       levelMatch,
			EmergencyCorrect: emergencyCorrect,
		})

		// ── Emergency sensitivity (recall) — computed FIRST. ──
		lr := rep.ByLanguage[v.Language]
		lr.Total++
		if v.ExpectedEmergency {
			rep.EmergencyTotal++
			lr.EmergencyTotal++
			if engineEmergency {
				rep.EmergencyDetected++
				lr.EmergencyDetected++
			} else {
				rep.EmergencyMissed++
				rep.EmergencyMissedCodes = append(rep.EmergencyMissedCodes, v.Code)
			}
		}

		// ── Triage accuracy + over/under-triage. ──
		if levelMatch {
			rep.LevelMatches++
			lr.LevelMatches++
		} else if engineLevel < v.ExpectedLevel {
			rep.OverTriage++ // lower level = MORE urgent than expected (safe side)
		} else {
			rep.UnderTriage++ // higher level = LESS urgent (risk side)
		}
		rep.ByLanguage[v.Language] = lr
	}

	// Finalize rates.
	rep.EmergencySensitivity = ratio(rep.EmergencyDetected, rep.EmergencyTotal)
	rep.Accuracy = ratio(rep.LevelMatches, rep.TotalVignettes)
	for code, lr := range rep.ByLanguage {
		lr.EmergencySensitivity = ratio(lr.EmergencyDetected, lr.EmergencyTotal)
		lr.Accuracy = ratio(lr.LevelMatches, lr.Total)
		rep.ByLanguage[code] = lr
	}
	return rep, nil
}

func ratio(num, den int) float64 {
	if den == 0 {
		return 1.0 // vacuously perfect — no cases of this kind to miss
	}
	return float64(num) / float64(den)
}

// SeedVignettes seeds a few representative African clinical vignettes spanning the
// disposition spectrum, with the malaria-endemic + paediatric/maternal cases SC-9
// cares about. Idempotent (upsert by code).
func (s *ValidationService) SeedVignettes(ctx context.Context) error {
	sym := func(code string) triage.Evidence {
		return triage.Evidence{Kind: "symptom", Code: code, Value: "present", Source: "user"}
	}
	seeds := []Vignette{
		{
			Code: "vg_malaria_fever_en", Language: "en", AgeYears: 28, Sex: "male", Region: "NG",
			Evidence:           []triage.Evidence{sym("s_fever"), sym("s_headache"), sym("s_weakness")},
			ExpectedLevel:      triage.LevelConsult24h, ExpectedEmergency: false,
			ExpectedConditions: []string{"Malaria"},
		},
		{
			Code: "vg_malaria_fever_pcm", Language: "pcm", AgeYears: 30, Sex: "female", Region: "NG",
			Evidence:           []triage.Evidence{sym("s_fever"), sym("s_weakness")},
			ExpectedLevel:      triage.LevelConsult, ExpectedEmergency: false,
			ExpectedConditions: []string{"Malaria"},
		},
		{
			Code: "vg_paeds_infant_fever_en", Language: "en", AgeYears: 0, Sex: "female", Region: "NG",
			Evidence:           []triage.Evidence{sym("s_fever")},
			ExpectedLevel:      triage.LevelEmergencyUrgent, ExpectedEmergency: true, // SC-9 infant fever
			ExpectedConditions: []string{},
		},
		{
			Code: "vg_maternal_bleeding_en", Language: "en", AgeYears: 26, Sex: "female", Region: "NG",
			Evidence:           []triage.Evidence{sym("s_bleeding"), sym("s_weakness")},
			ExpectedLevel:      triage.LevelEmergencyAmbulance, ExpectedEmergency: true, // pregnant set at run via region/age? handled by rule
			ExpectedConditions: []string{},
		},
		{
			Code: "vg_unconscious_emergency_en", Language: "en", AgeYears: 45, Sex: "male", Region: "NG",
			Evidence:           []triage.Evidence{sym("s_unconscious")},
			ExpectedLevel:      triage.LevelEmergencyAmbulance, ExpectedEmergency: true,
			ExpectedConditions: []string{},
		},
		{
			Code: "vg_self_care_mild_en", Language: "en", AgeYears: 22, Sex: "male", Region: "NG",
			Evidence:           []triage.Evidence{sym("s_cough")},
			ExpectedLevel:      triage.LevelSelfCare, ExpectedEmergency: false,
			ExpectedConditions: []string{"Common viral illness"},
		},
	}
	for i := range seeds {
		if _, err := s.store.UpsertVignette(ctx, &seeds[i]); err != nil {
			return err
		}
	}
	return nil
}
