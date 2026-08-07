package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

// spyAudit is a fake AuditService sink that records every LogAction call so
// tests can assert that a sensitive mutation emitted the expected audit event.
type spyAudit struct {
	mu      sync.Mutex
	actions []spyAuditEntry
}

type spyAuditEntry struct {
	Action       string
	Module       string
	ResourceType string
	Severity     string
}

func (s *spyAudit) LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.actions = append(s.actions, spyAuditEntry{Action: action, Module: module, ResourceType: resourceType, Severity: severity})
}
func (s *spyAudit) LogLogin(string, string, string, string, string, string, map[string]any) {}
func (s *spyAudit) ListAuditLogs(domain.AuditFilter) ([]map[string]any, error)              { return nil, nil }
func (s *spyAudit) ListLoginActivity(domain.AuditFilter) ([]map[string]any, error) {
	return nil, nil
}
func (s *spyAudit) ListSecurityEvents(domain.AuditFilter) ([]map[string]any, error) {
	return nil, nil
}

func (s *spyAudit) has(action string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.actions {
		if a.Action == action {
			return true
		}
	}
	return false
}

func (s *spyAudit) entry(action string) (spyAuditEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.actions {
		if a.Action == action {
			return a, true
		}
	}
	return spyAuditEntry{}, false
}

// stemAuditService is a no-op StemService that returns benign values so each
// handler reaches its success path (and therefore its audit emission). Only the
// methods exercised by the table below need meaningful returns.
type stemAuditService struct{ services.StemService }

func (stemAuditService) CreateSchool(domain.StemSchoolCreateInput) (domain.StemSchool, error) {
	return domain.StemSchool{ID: "school-1"}, nil
}
func (stemAuditService) UpdateSchoolVerification(string, string, string, string) error { return nil }
func (stemAuditService) CreateContest(domain.StemContestCreateInput) (domain.StemContest, error) {
	return domain.StemContest{ID: "contest-1"}, nil
}
func (stemAuditService) UpdateSubmissionStatus(string, string, string) error { return nil }
func (stemAuditService) UpsertJudgingScore(domain.StemJudgingScore) (domain.StemJudgingScore, error) {
	return domain.StemJudgingScore{ID: "score-1"}, nil
}
func (stemAuditService) UpdateJudgingScoreReviewState(string, string, bool, string, string) error {
	return nil
}
func (stemAuditService) CreateJudgeAssignment(domain.StemJudgeAssignment) (domain.StemJudgeAssignment, error) {
	return domain.StemJudgeAssignment{ID: "assign-1"}, nil
}
func (stemAuditService) UpdateJudgeAssignmentConflict(string, bool, string, string) error { return nil }
func (stemAuditService) AwardBadge(domain.StemBadgeAward) (domain.StemBadgeAward, error) {
	return domain.StemBadgeAward{ID: "award-1"}, nil
}
func (stemAuditService) CreateCertificate(domain.StemCertificate) (domain.StemCertificate, error) {
	return domain.StemCertificate{ID: "cert-1"}, nil
}
func (stemAuditService) CreateVoteTransaction(domain.StemVoteTransaction) (domain.StemVoteTransaction, error) {
	return domain.StemVoteTransaction{ID: "vote-1"}, nil
}

func TestStemMutationsEmitAudit(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name         string
		method       string
		route        string
		path         string
		body         string
		bind         func(*StemHandler) gin.HandlerFunc
		wantAction   string
		wantSeverity string
	}{
		{
			name: "school create", method: http.MethodPost, route: "/schools", path: "/schools",
			body:       `{"schoolName":"Acme High","state":"Lagos"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.CreateSchool },
			wantAction: "stem.school.create", wantSeverity: "medium",
		},
		{
			name: "school verification transition", method: http.MethodPatch, route: "/schools/:id/verification", path: "/schools/s1/verification",
			body:       `{"status":"APPROVED","reason":"ok"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.UpdateSchoolVerification },
			wantAction: "stem.school.verification", wantSeverity: "high",
		},
		{
			name: "contest create", method: http.MethodPost, route: "/contests", path: "/contests",
			body:       `{"name":"Robotics","slug":"robotics"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.CreateContest },
			wantAction: "stem.contest.create", wantSeverity: "high",
		},
		{
			name: "submission status transition", method: http.MethodPatch, route: "/submissions/:id/status", path: "/submissions/sub1/status",
			body:       `{"status":"approved"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.UpdateSubmissionStatus },
			wantAction: "stem.submission.status", wantSeverity: "high",
		},
		{
			name: "judging score upsert", method: http.MethodPost, route: "/scores", path: "/scores",
			body:       `{"applicationId":"app1"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.CreateJudgingScore },
			wantAction: "stem.judging.score.upsert", wantSeverity: "high",
		},
		{
			name: "judging score review state", method: http.MethodPatch, route: "/scores/:id/review-state", path: "/scores/sc1/review-state",
			body:       `{"reviewStatus":"approved"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.UpdateJudgingScoreReviewState },
			wantAction: "stem.judging.score.review_state", wantSeverity: "high",
		},
		{
			name: "judge assignment create", method: http.MethodPost, route: "/assignments", path: "/assignments",
			body:       `{"contestId":"c1","applicationId":"a1","judgeUserId":"j1"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.CreateJudgeAssignment },
			wantAction: "stem.judging.assignment.create", wantSeverity: "high",
		},
		{
			name: "judge assignment conflict", method: http.MethodPatch, route: "/assignments/:id/conflict", path: "/assignments/as1/conflict",
			body:       `{"hasConflict":true,"conflictReason":"relative"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.UpdateJudgeAssignmentConflict },
			wantAction: "stem.judging.assignment.conflict", wantSeverity: "high",
		},
		{
			name: "award badge", method: http.MethodPost, route: "/badge-awards", path: "/badge-awards",
			body:       `{"badgeId":"b1"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.AwardBadge },
			wantAction: "stem.award.badge.grant", wantSeverity: "high",
		},
		{
			name: "create certificate", method: http.MethodPost, route: "/certificates", path: "/certificates",
			body:       `{"certificateType":"winner","certificateNumber":"CN-1"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.CreateCertificate },
			wantAction: "stem.award.certificate.create", wantSeverity: "high",
		},
		{
			name: "vote transaction create", method: http.MethodPost, route: "/vote-transactions", path: "/vote-transactions",
			body:       `{"contestId":"c1","voterRef":"v1"}`,
			bind:       func(h *StemHandler) gin.HandlerFunc { return h.CreateVoteTransaction },
			wantAction: "stem.voting.transaction.create", wantSeverity: "high",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spy := &spyAudit{}
			h := NewStemHandler(stemAuditService{}).WithAudit(spy)
			r := gin.New()
			r.Handle(tc.method, tc.route, tc.bind(h))

			req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code >= 400 {
				t.Fatalf("handler returned %d (body=%s)", w.Code, w.Body.String())
			}
			e, ok := spy.entry(tc.wantAction)
			if !ok {
				t.Fatalf("expected audit action %q, got %+v", tc.wantAction, spy.actions)
			}
			if e.Module != "stem" {
				t.Fatalf("expected module=stem, got %q", e.Module)
			}
			if e.Severity != tc.wantSeverity {
				t.Fatalf("expected severity %q, got %q", tc.wantSeverity, e.Severity)
			}
		})
	}
}

// When no audit sink is attached, mutations must NOT panic (nil-safe no-op).
func TestStemMutationNilAuditSafe(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(stemAuditService{}) // no WithAudit
	r := gin.New()
	r.POST("/contests", h.CreateContest)
	req := httptest.NewRequest(http.MethodPost, "/contests", bytes.NewBufferString(`{"name":"X","slug":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
}
