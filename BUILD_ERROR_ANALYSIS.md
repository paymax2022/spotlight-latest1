# BUILD ERROR ANALYSIS & PRIORITIZATION

## SEVERITY CLASSIFICATION

### FRONTEND-ADMIN (70 Errors) — MEDIUM SEVERITY
**Category Breakdown:**
- Missing Service Exports (30 errors): `listCategories`, `getUserAdmin`, `listAppeals`, etc.
- Missing RBAC Types (26 errors): `taxonomy`, `usersView`, `usersAction`, `pricing`, `cms`, `appealsReview`, `appealsDecide`, `analytics`
- Type Mismatches (14 errors): Color hex values `#15803d` vs `#7367f0` (Recharts Badge component constraint)

**Impact:** Medium - Type safety only, no runtime blocking
**Root Cause:** Incomplete marketplace admin service implementation + RBAC permissions enum missing properties
**Quickest Fix:**
1. Export stub functions in marketplaceAdminService (return empty data)
2. Add missing RBAC permission keys to the permissions enum
3. Adjust color hex values to match component signature

---

### FRONTEND-WEB (18 Errors) — LOW SEVERITY
**Category Breakdown:**
1. **useParams null checks (4 errors)** - BLOCKING at runtime:
   - admin-voting/page.tsx:23 (params is possibly null)
   - stages/evictions/page.tsx:27,28 (params is possibly null)
   - stages/page.tsx:26 (params is possibly null)
   - FIX: Change `params.contestId` to `(params?.contestId as string) || ''`

2. **Recharts type errors (2 errors)** - Charting library mismatch:
   - admin/academy/analytics/page.tsx:261 (grade, count not in PieLabelRenderProps)
   - FIX: Use correct Recharts render props API; wrap data differently

3. **Compliance hooks type mismatches (12 errors)** - Logic errors:
   - useBackgroundSync: 7 errors (string vs number type mismatches, missing ServiceWorkerRegistration.sync)
   - usePerformanceDashboard: 1 error (alert type strict union)
   - trendAnalysis: 1 error (comparison type mismatch)
   - encryption utils: 2 errors (crypto overload, return type)

**Impact:** Low - Build succeeds with TypeScript ignored; hooks need type fixes but not critical
**Root Cause:** Newly added Slices 22-24 compliance code with incomplete type contracts
**Quickest Fix:**
1. Add optional chaining to params access (1-2 min)
2. Fix Recharts render props (5-10 min)
3. Type-fix compliance hooks individually (20-30 min)

---

### BACKEND (45 Errors) — CRITICAL SEVERITY
**Category Breakdown:**

1. **Duplicate Declarations (8 errors)** - BLOCKING:
   - curriculum/model.go:229 - Lesson redeclared (line 87 also declares Lesson)
   - curriculum/repository.go:521,524,562 - lessonCols, scanLesson, GetLessonByID redeclared
   - curriculum/service.go:105 - GetLesson redeclared (line 67)
   - curriculum/handler.go:193,202 - ListTopicLessons, GetLesson redeclared
   - exam/service.go:454 - GetAttemptResult redeclared (line 219)
   - restaurant/handler_withdrawal.go:20 - ownerErrStatus redeclared

2. **Missing Type Definitions (5 errors)** - BLOCKING:
   - ServedQuestion (exam/service.go:188, exam/repository.go:677,689,691)
   - ErrIdempotencyKeyConflict (fees/invoice/handler.go:64)

3. **Missing Struct Fields (8 errors)** - BLOCKING:
   - MockExamAttempt missing: ScorePercent (4x), TotalSeconds (2x)
   - MockExamInstance missing: InstanceCode
   - SubjectScore missing: Name field (3x)
   - Service missing: recordOrderEvent, refundAndClose, withdrawalsOn, disburser, cardKey

4. **Undefined Functions (2 errors)** - BLOCKING:
   - calculateGrade (assessment/mock_exam_pdf.go:124)
   - CompleteDueBoosts (marketplace-cron/main.go:68)

5. **Type Contract Violations (4 errors)** - BLOCKING:
   - Performance field is RawMessage, not interface (assessment/mock_exam_pdf.go:142)
   - attempt.Performance slice type invalid operation

**Impact:** Critical - Prevents Go build; 0% compilation success
**Root Cause:** Merge conflict resolution took incompatible code paths; curriculum/exam/restaurant modules have conflicting commits
**Quickest Fix Strategy:**
1. Remove duplicate declarations (identify newer versions, delete old)
2. Define missing types (ServedQuestion, restore ErrIdempotencyKeyConflict from main)
3. Restore missing struct fields from origin/main versions
4. Restore missing functions (calculateGrade, CompleteDueBoosts)

---

## RECOMMENDED FIX PRIORITY

### PHASE 1 (BLOCKING - Must fix to unblock CI)
**Priority: Backend (CRITICAL)**
- Time: ~2-3 hours
- Approach: Cherry-pick function/type definitions from origin/main; resolve duplicates
- Strategy: 
  1. For each duplicate (Lesson, lessonCols, etc.), check which version is newer
  2. Delete the older declaration
  3. Re-run `go build` iteratively
  4. Add missing struct fields by comparing feat branch vs main struct definitions
  5. Restore missing error types and functions from main

### PHASE 2 (TYPE SAFETY - Improves maintainability)
**Priority: Frontend-Admin (MEDIUM)**
- Time: ~1-2 hours
- Approach: Stub missing service exports + add RBAC enum properties
- Files to fix:
  - frontend-admin/src/services/marketplaceAdminService.ts (add 15+ stub exports)
  - src/constants/rbac.ts or similar (add taxonomy, usersView, usersAction, etc. to enum)
  - Replace color hex values that violate Recharts Badge type

### PHASE 3 (TYPE ERRORS - Quality only)
**Priority: Frontend-Web (LOW)**
- Time: ~1 hour
- Approach: Quick-fix null checks; investigate Recharts mismatch; type-fix compliance hooks
- Files to fix:
  - app/admin/(dashboard)/voting/**/*page.tsx (add optional chaining)
  - app/admin/academy/analytics/page.tsx (Recharts render props)
  - hooks/useBackgroundSync.ts (type conversions)
  - hooks/usePerformanceDashboard.ts (union type fix)
  - lib/compliance/* (type contracts)

---

## EXECUTION ROADMAP

```
Week 1 (Critical Path):
├─ Day 1: Backend compilation fixes (duplicates, missing types, fields) → Go build passes
├─ Day 2: Frontend-Admin type safety (service exports, RBAC enum) → npm type-check passes
└─ Day 3: Frontend-Web type fixes (params null checks, Recharts, compliance) → tsc passes

Then:
└─ Full integration test + deploy to staging
```

