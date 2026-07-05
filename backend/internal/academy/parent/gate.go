package parent

// gate.go holds the PURE child-safety decision + report-aggregation helpers (no DB,
// no ctx) so they are trivially unit-testable.
//
// GOLDEN RULE (nfr.md child-safety): a guardian may only act on a minor they hold
// an ACTIVE guardian link to. canActOnMinor is the single fail-closed decision the
// service consults on every (guardian, minor) operation: the only input that grants
// access is an active link. Anything else (no link, pending, revoked → linkActive
// false) is denied.

// canActOnMinor reports whether a guardian may act on a minor. It is fail-closed:
// it returns true ONLY when the guardian holds an active link to that minor.
// The caller resolves linkActive from academy_guardian_links.status == 'active'.
func canActOnMinor(linkActive bool) bool {
	return linkActive
}

// validApprovalDecision normalises a decision string to the target approval state,
// or returns ("", false) for anything other than approve/reject.
func validApprovalDecision(decision string) (ApprovalState, bool) {
	switch decision {
	case "approve":
		return ApprovalApproved, true
	case "reject":
		return ApprovalRejected, true
	default:
		return "", false
	}
}

// validChannel reports whether c is a known notification channel.
func validChannel(c string) bool {
	switch c {
	case "push", "sms", "in_app", "email":
		return true
	default:
		return false
	}
}

// aggregateMasteryBySubject folds per-objective mastery rows into per-subject
// summaries. Pure: no DB. "mastered" counts the mastered + exam_ready states;
// avg_score is the mean objective score; mastery_ratio is mastered/objectives.
func aggregateMasteryBySubject(rows []MasteryRow) []SubjectMastery {
	type acc struct {
		code, name string
		objectives int
		mastered   int
		scoreSum   float64
	}
	order := []string{}
	byID := map[string]*acc{}
	for _, r := range rows {
		a, ok := byID[r.SubjectID]
		if !ok {
			a = &acc{code: r.SubjectCode, name: r.SubjectName}
			byID[r.SubjectID] = a
			order = append(order, r.SubjectID)
		}
		a.objectives++
		a.scoreSum += r.Score
		if r.State == "mastered" || r.State == "exam_ready" {
			a.mastered++
		}
	}
	out := make([]SubjectMastery, 0, len(order))
	for _, id := range order {
		a := byID[id]
		avg := 0.0
		ratio := 0.0
		if a.objectives > 0 {
			avg = a.scoreSum / float64(a.objectives)
			ratio = float64(a.mastered) / float64(a.objectives)
		}
		out = append(out, SubjectMastery{
			SubjectID:    id,
			SubjectCode:  a.code,
			SubjectName:  a.name,
			Objectives:   a.objectives,
			Mastered:     a.mastered,
			AvgScore:     avg,
			MasteryRatio: ratio,
		})
	}
	return out
}

// buildReportPayload aggregates the stats stored in academy_progress_reports.payload.
// Pure helper so the aggregation math is unit-testable independent of the DB.
func buildReportPayload(period string, subjects []SubjectMastery, eventCount int, readiness *float64) map[string]any {
	totalObjectives := 0
	totalMastered := 0
	scoreSum := 0.0
	for _, s := range subjects {
		totalObjectives += s.Objectives
		totalMastered += s.Mastered
		scoreSum += s.AvgScore * float64(s.Objectives)
	}
	overallScore := 0.0
	if totalObjectives > 0 {
		overallScore = scoreSum / float64(totalObjectives)
	}
	payload := map[string]any{
		"period":           period,
		"subjects":         subjects,
		"total_objectives": totalObjectives,
		"total_mastered":   totalMastered,
		"overall_score":    overallScore,
		"event_count":      eventCount,
	}
	if readiness != nil {
		payload["exam_readiness"] = *readiness
	}
	return payload
}
