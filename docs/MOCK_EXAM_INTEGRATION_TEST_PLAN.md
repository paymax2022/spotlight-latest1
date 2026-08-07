# Mock Exam System - Integration Test Plan

## Overview
This document outlines the comprehensive integration testing strategy for the Spotlight Academy Mock Exam System (Slice 8). Tests verify end-to-end workflows from frontend UI through backend APIs to database persistence.

## Test Scope

### Phases
1. **Unit Test Validation** - API client and handler functions
2. **Workflow Integration** - Complete learner exam journey
3. **Admin Operations** - Template management and analytics
4. **Error Handling** - Edge cases and failure scenarios
5. **Performance & Load** - Concurrent user simulation
6. **Analytics Verification** - Data aggregation accuracy

## Frontend Tests (TypeScript/Vitest)

### Test File: `frontend-web/tests/academy-mock-exams.test.ts`

#### API Client Tests
- ✅ `listTemplates()` - Browse available exams
  - Without filters
  - With class/exam_type filters
  - Pagination support
  - Error handling on 404

- ✅ `getTemplate(id)` - Fetch single template with instances
  - Valid template ID
  - Invalid template ID
  - Sections and questions structure

- ✅ `startExam(templateId)` - Begin new attempt
  - Creates attempt in database
  - Returns attempt_id for progress tracking
  - Time tracking starts
  - Error on invalid template

- ✅ `getProgress(attemptId)` - Retrieve exam state
  - Question list with metadata
  - Current answers map
  - Progress percentage
  - Time elapsed/remaining
  - Flagged questions list

- ✅ `saveProgress(attemptId, answers, flagged)` - Autosave
  - Persists partial answers
  - Updates flagged questions
  - No-op on submission (read-only after submit)
  - Idempotent with same payload

- ✅ `submitExam(attemptId, answers)` - Finalize exam
  - Locks attempt (read-only)
  - Triggers grading
  - Returns score and grade
  - Prevents duplicate submissions

- ✅ `getResults(attemptId)` - View scored exam
  - Score percentage and letter grade
  - Performance breakdown (correct/incorrect/unanswered)
  - Per-section analysis
  - Personalized recommendations

- ✅ `getStatistics(templateId)` - Template-level stats
  - Attempts count
  - Average score
  - Pass rate
  - Grade distribution

- ✅ `getLearnerAnalytics()` - Personal dashboard data
  - Total attempts
  - Average/best/worst scores
  - Pass rate
  - Trend data (7-day history)
  - Subject performance
  - Weak areas identification
  - Recommendation generation

- ✅ `getAdminAnalytics(timeRange)` - System-wide metrics
  - Active learners count
  - Total attempts
  - System average score
  - Pass rate
  - Time range filtering (week/month/quarter/year)
  - Activity trend chart
  - Class performance breakdown
  - Grade distribution pie
  - Most popular exams ranking

#### Error Handling Tests
- Network errors (fetch rejection)
- Non-OK HTTP responses (404, 500, etc.)
- Malformed JSON responses
- Missing required fields in response
- Timeout handling

---

## Backend Tests (Go)

### Test File: `backend/tests/academy_mock_exam_integration_test.go`

#### Workflow Tests: `TestMockExamIntegration`

**Complete Exam Journey:**
1. List Templates (GET `/academy/mock-exams/templates`)
   - Returns array of templates
   - Contains: id, name, exam_type, total_questions, total_minutes
   - Status filtered to 'approved' only

2. Get Template (GET `/academy/mock-exams/templates/{id}`)
   - Returns full template with sections
   - Includes available instances

3. Start Exam (POST `/academy/mock-exams/start`)
   - Request: `{ template_id: string }`
   - Response: attempt with id, status='in_progress', started_at timestamp
   - Database: INSERT into academy_mock_exam_attempts
   - Side effect: Begins timer

4. Get Progress (GET `/academy/mock-exams/attempts/{attempt_id}`)
   - Returns current exam state
   - Includes all questions with options (no answers)
   - Progress: answered_count / total_questions
   - time_remaining calculated from total_seconds - elapsed

5. Save Progress (POST `/academy/mock-exams/attempts/{attempt_id}/save`)
   - Request: `{ answers: { q_id: answer }, flagged_questions: [q_ids] }`
   - Updates academy_mock_attempt_metadata
   - Side effect: Updates progress timer
   - Response: 200 OK (minimal response)

6. Submit Exam (POST `/academy/mock-exams/attempts/{attempt_id}/submit`)
   - Request: `{ answers: { q_id: answer } }`
   - Locks attempt: status='submitted'
   - Triggers grading: calculateGrade(answer_sheet, answer_key)
   - Database: INSERT graded result with score, grade, performance breakdown
   - Response: score_percent, grade, performance
   - Prevents re-submission (idempotent key required)

7. Get Results (GET `/academy/mock-exams/results/{attempt_id}`)
   - Returns graded attempt
   - Includes: score, score_percent, grade, performance object
   - By-section breakdown (if applicable)
   - graded_at timestamp

8. Get Statistics (GET `/academy/mock-exams/statistics/{template_id}`)
   - Aggregated metrics across all instances of this template
   - Total attempts, average score, pass rate, grade distribution
   - Performance by difficulty level

9. Get Learner Analytics (GET `/academy/mock-exams/analytics`)
   - User-scoped: only learner's own attempts
   - 7-day trend with class average overlay
   - Subject performance ranking
   - Weak areas < 70% accuracy
   - Personalized recommendations

#### Admin Tests: `TestMockExamAdminManagement`

1. List Templates (GET `/admin/mock-exams/templates`)
   - Returns all templates (including draft/archived)
   - Requires `academy.assessment` permission
   - Pagination support

2. Create Template (POST `/admin/mock-exams/templates`)
   - Request fields: name, description, class_id, exam_type, total_questions, total_minutes
   - Creates in 'draft' status
   - Returns template_id for editing
   - Validation: class_id in valid list, exam_type in ['class_mock', 'subject_mock', 'practice_drill']

3. Update Template (PUT `/admin/mock-exams/templates/{id}`)
   - Only draft templates editable
   - Updates: name, description, sections
   - Cannot change: class_id, exam_type, total_questions

4. Transition Template (POST `/admin/mock-exams/templates/{id}/transition`)
   - draft → approved: validates completeness (all sections, Q&A)
   - approved → archived: soft-delete, prevents new instances

5. Archive Template (DELETE `/admin/mock-exams/templates/{id}`)
   - Marks status='archived'
   - Existing attempts still graded
   - No new attempts allowed

6. Get Admin Analytics (GET `/admin/mock-exams/analytics?timeRange=week|month|quarter|year`)
   - System-wide KPIs: active_learners, total_attempts, avg_score, pass_rate
   - Time-bounded aggregation (excludes future, includes range)
   - Activity trend: attempts per day + unique learners per day
   - Class performance: avg_score and pass_rate by class_id
   - Grade distribution: count of A/B/C/D/F across all exams
   - Popular exams: top 8 by attempts, with avg_score and pass_rate

#### Error Handling Tests: `TestMockExamErrorHandling`

1. Invalid Template ID
   - `GET /academy/mock-exams/templates/invalid` → 404

2. Missing Authorization
   - Request without Authorization header → 401

3. Invalid Payload
   - `POST /academy/mock-exams/start` with malformed JSON → 400

4. Attempt Not Found
   - `GET /academy/mock-exams/attempts/nonexistent` → 404

5. Permission Denied
   - Non-admin accessing `/admin/mock-exams/*` → 403

6. Concurrent Submission
   - Two simultaneous submits of same attempt → idempotency prevents double-grade

---

## Database Verification

### Tables to Verify
- `academy_mock_exam_templates` - Seeded with 18 templates
- `academy_mock_exam_instances` - 134 variants (3-4 per template)
- `academy_mock_question_mappings` - Links Q bank questions to exam sections
- `academy_mock_attempt_metadata` - Learner progress and answers
- `academy_mock_statistics` - Aggregated stats by template

### Queries to Validate
```sql
-- Verify template count
SELECT COUNT(*) FROM academy_mock_exam_templates WHERE status='approved';
-- Expected: 18

-- Verify instances per template
SELECT template_id, COUNT(*) FROM academy_mock_exam_instances 
GROUP BY template_id;
-- Expected: Each template has 3-4 instances

-- Verify attempt grading
SELECT status, COUNT(*) FROM academy_mock_attempt_metadata 
GROUP BY status;
-- Expected: Mix of 'in_progress', 'submitted', 'graded'

-- Verify performance calculations
SELECT AVG(score_percent) FROM academy_mock_attempt_metadata 
WHERE status='graded';
-- Expected: ~71.8% (system average)
```

---

## Test Execution Checklist

### Pre-Test Setup
- [ ] Database migrated: `supabase db push`
- [ ] Test templates seeded (18 templates)
- [ ] Test instances seeded (134 instances)
- [ ] Backend compiled: `go build ./...`
- [ ] Frontend dependencies: `npm install`
- [ ] Environment: TEST_DATABASE_URL set

### Run Frontend Tests
```bash
cd frontend-web
npm run test academy-mock-exams
```
Expected: All 18 test suites pass

### Run Backend Tests
```bash
cd backend
go test -v ./tests -run TestMockExam
```
Expected: 3 test functions pass (~45 assertions total)

### Manual Smoke Tests (if needed)
1. Start dev server: `npm run dev` (frontend)
2. Navigate to `/academy/mock-exams`
3. Click browse templates → should show 18 exams
4. Start an exam → timer starts, questions appear
5. Answer 5 questions → click "Save Progress"
6. Submit exam → grade and score calculated
7. View results → performance breakdown displays
8. Check analytics → learner trends chart loads

### Performance Baseline
- List templates: < 200ms
- Get progress: < 300ms (with 50 questions)
- Submit exam + grade: < 1s (with grading on write)
- Analytics aggregation: < 500ms

---

## Known Limitations & Future Work

### Current Scope (Slice 8)
- Mock analytics data (real data when repo integration complete)
- Single-variant per exam session (shuffling deterministic)
- English language only

### Post-Slice Enhancements (Slice 9+)
- Live analytics refresh (WebSocket or polling)
- Per-question analytics (which Q is hardest)
- Learning path recommendations (based on weak areas)
- Comparison against class average (privacy-safe)
- Export results as PDF
- Leaderboard (learner opt-in, class-scoped)
- Practice mode (unlimited retakes, hints allowed)
- Mobile optimization testing

---

## Sign-Off Criteria

✅ **Integration tests pass:**
- 18 template API tests
- 9 workflow tests (start → submit → results)
- 6 admin operation tests
- 3 error handling test suites
- 12 API client tests (frontend)

✅ **Manual verification:**
- Learner can complete end-to-end exam
- Results display correctly
- Analytics charts render
- Admin can create/archive templates

✅ **Performance:**
- No 500+ errors in backend logs
- Frontend loads in < 3s
- Analytics queries < 500ms

---

**Test Plan Version:** 1.0  
**Last Updated:** 2026-08-06  
**Owner:** Claude Code (Slice 8)
