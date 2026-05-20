# Spotlight Film Academy Hybrid Learning MVP

## Step 1 — Project Audit

### Current Spotlight stack

- Frontend: Next.js 15 App Router, React 19, TypeScript, Tailwind CSS
- Backend: Next.js route handlers with server-side domain services under `src/server/services`
- Database/Auth/Storage: Supabase
- Payments: Paystack
- Admin shell: shared sidebar and admin pages under `src/app/admin/**`

### Existing reusable areas

- Academy admissions and payment flow:
  - `src/app/film-academy/page.tsx`
  - `src/server/services/academy/service.ts`
- Academy admin operations:
  - `src/app/admin/academy/page.tsx`
  - `src/app/api/admin/academy/**`
- Shared auth/permissions:
  - `src/lib/auth/server.ts`
  - `src/middleware.ts`
- Shared response helpers and validation patterns:
  - `src/lib/api/responses.ts`
  - `src/lib/validation/**`
- Shared admin navigation:
  - `src/components/AdminSidebar.tsx`

### Integration constraints

- Existing academy feature already handles applications, batches, settings, and payments, so LMS work must extend that domain instead of replacing it.
- The codebase uses a mixed monolith-plus-service pattern; new academy business rules should stay centralized in `src/server/services/academy`.
- Supabase RLS and admin/service-client boundaries are already important across the project; admin-only LMS operations should stay server-owned.
- Existing design language should be preserved so the LMS feels native to Spotlight.

### Recommended integration approach

Implement Film Academy Hybrid Learning as a bounded domain inside the existing codebase:

- Keep admissions on `/film-academy`
- Add candidate learning flow on `/film-academy/dashboard`
- Add admin learning operations on `/admin/academy/lms`
- Centralize academy learning rules in `src/server/services/academy/lms.ts`

## Step 2 — Implementation Blueprint

### Feature decomposition

1. Academy onboarding and application
2. Candidate dashboard and stage progression
3. Program, module, and lesson delivery
4. Lesson completion tracking
5. Exam engine and auto-grading
6. Practical invitation workflow
7. Academy admin operations and reporting
8. Audit and status history

### Data model

The MVP extends the existing academy schema with:

- `academy_programs`
- `academy_modules`
- `academy_lessons`
- `academy_enrollments`
- `academy_lesson_progress`
- `academy_exams`
- `academy_exam_questions`
- `academy_exam_attempts`
- `academy_practical_sessions`
- `academy_practical_invitations`
- `academy_candidate_stage_history`

### Candidate routes

- `/film-academy`
- `/film-academy/dashboard`
- `/api/academy/lms/dashboard`
- `/api/academy/lms/lessons/[id]/complete`
- `/api/academy/lms/exams/[id]`
- `/api/academy/lms/exams/[id]/submit`
- `/api/academy/lms/practical-invitations/[id]/confirm`

### Admin routes

- `/admin/academy`
- `/admin/academy/lms`
- `/api/admin/academy/lms`
- `/api/admin/academy/lms/programs`
- `/api/admin/academy/lms/modules`
- `/api/admin/academy/lms/lessons`
- `/api/admin/academy/lms/exams`
- `/api/admin/academy/lms/questions`
- `/api/admin/academy/lms/enrollments`
- `/api/admin/academy/lms/enrollments/[id]/stage`
- `/api/admin/academy/lms/practical-sessions`
- `/api/admin/academy/lms/practical-invitations`
- `/api/admin/academy/lms/resources/upload`

### Status pipeline

- `applied`
- `approved`
- `enrolled`
- `online_in_progress`
- `online_completed`
- `exam_eligible`
- `exam_taken`
- `exam_passed`
- `exam_failed`
- `practical_invited`
- `practical_confirmed`
- `practical_completed`

### Service boundaries

- Admissions/payment: `src/server/services/academy/service.ts`
- Learning/exam/practical domain: `src/server/services/academy/lms.ts`
- Validation: `src/lib/validation/academy.ts`, `src/lib/validation/academy-lms.ts`

## Step 3 — Task Breakdown

### Foundation

- Add academy hybrid learning schema migration
- Add validation schemas and academy LMS constants
- Add candidate and admin academy LMS service layer

### Candidate experience

- Build academy dashboard with stage tracking
- Build lesson progression and completion actions
- Build exam access, submission, and results
- Build practical invitation confirmation flow

### Admin experience

- Build academy LMS console for:
  - applications to enrollment handoff
  - programs, modules, lessons
  - exams and question bank
  - practical sessions and invitations
  - stage overrides and basic reporting

### Integration

- Add admin navigation to the LMS console
- Add candidate navigation to academy dashboard
- Ensure shared auth/permission behavior returns correct status codes

### QA

- Typecheck
- Targeted lint
- Full build
- Manual flow verification against:
  - application -> approval -> enrollment
  - lesson completion -> exam eligibility
  - exam submission -> pass/fail stage update
  - practical invite -> candidate confirmation

## Step 4 — Current MVP Implementation Status

### Implemented in this tranche

- Hybrid learning schema migration:
  - `supabase/migrations/20260408110000_academy_hybrid_learning_mvp.sql`
- Academy LMS validation:
  - `src/lib/validation/academy-lms.ts`
- Academy LMS service layer:
  - `src/server/services/academy/lms.ts`
- Candidate academy dashboard:
  - `src/app/film-academy/dashboard/page.tsx`
- Candidate LMS APIs:
  - `src/app/api/academy/lms/**`
- Admin academy LMS APIs:
  - `src/app/api/admin/academy/lms/**`
- Admin academy LMS console:
  - `src/app/admin/academy/lms/page.tsx`
- Navigation and integration:
  - `src/components/AdminSidebar.tsx`
  - `src/app/admin/academy/page.tsx`
  - `src/app/film-academy/page.tsx`

### Remaining later-phase work

- Notifications/email delivery for invites and results
- Certificates
- Instructor persona
- richer analytics and exportable reports
- automated integration and e2e coverage for academy flows
