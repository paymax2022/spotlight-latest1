# Spotlight — Route & Endpoint Inventory
> Audit date: 2026-06-13 | Sources: backend/internal/app/router.go, frontend-web/src/app/**/route.ts

---

## Go Backend — `/Users/paymax/Desktop/wordpress/spotlight/new/backend/internal/app/router.go`

**Framework:** Gin v1.10.0 | **Base:** `http://localhost:8080`

---

### Auth Routes — `/api/auth/*`

| Method | Path | Handler | Auth | Notes |
|---|---|---|---|---|
| POST | /api/auth/register | authHandler.Register | None | Creates auth.users + user_profiles |
| POST | /api/auth/login | authHandler.Login | None | Returns JWT |
| POST | /api/auth/logout | authHandler.Logout | None | Clears session |
| POST | /api/auth/request-password-reset | authHandler.RequestPasswordReset | None | Sends reset email |
| POST | /api/auth/reset-password | authHandler.ResetPassword | None | Token in body |
| GET | /api/auth/verify-email | authHandler.VerifyEmail | None | Token in query param |
| POST | /api/auth/resend-verification-link | authHandler.ResendVerificationLink | None | |
| GET | /api/auth/me | authHandler.Me | **JWT (RequireAuthContext)** | Returns current user + roles |
| POST | /api/auth/change-password | authHandler.ChangePassword | **JWT** | |
| POST | /api/auth/complete-profile | authHandler.CompleteProfile | **JWT** | |

---

### RBAC Admin Routes — `/api/admin/*`
**Middleware:** RequireAuthContext (JWT validation + RBAC load)

| Method | Path | Handler | Permission Required |
|---|---|---|---|
| GET | /api/admin/roles | rbacHandler.ListRoles | roles.view |
| POST | /api/admin/roles | rbacHandler.CreateRole | roles.create |
| PATCH | /api/admin/roles/:id | rbacHandler.UpdateRole | roles.update |
| POST | /api/admin/roles/:id/clone | rbacHandler.CloneRole | roles.create |
| DELETE | /api/admin/roles/:id | rbacHandler.DeleteRole | roles.delete |
| GET | /api/admin/permissions | rbacHandler.ListPermissions | permissions.view |
| POST | /api/admin/permissions | rbacHandler.CreatePermission | permissions.assign |
| PATCH | /api/admin/permissions/:id | rbacHandler.UpdatePermission | permissions.assign |
| GET | /api/admin/permissions/matrix | rbacHandler.PermissionMatrix | permissions.view |
| DELETE | /api/admin/permissions/:id | rbacHandler.DeletePermission | permissions.delete |
| POST | /api/admin/roles/:id/permissions | rbacHandler.AssignPermissionToRole | permissions.assign |
| DELETE | /api/admin/roles/:id/permissions/:pid | rbacHandler.RemovePermissionFromRole | permissions.assign |
| POST | /api/admin/users/:id/roles | rbacHandler.AssignRoleToUser | users.roles.assign |
| DELETE | /api/admin/users/:id/roles/:roleId | rbacHandler.RemoveRoleFromUser | users.roles.assign |
| PATCH | /api/admin/users/:id/suspend | rbacHandler.SuspendUser | users.suspend |
| PATCH | /api/admin/users/:id/unsuspend | rbacHandler.UnsuspendUser | users.suspend |
| PATCH | /api/admin/users/:id/lock | rbacHandler.LockUser | users.update |
| PATCH | /api/admin/users/:id/unlock | rbacHandler.UnlockUser | users.update |
| GET | /api/admin/audit-logs | auditHandler.AuditLogs | audit.logs.view |
| GET | /api/admin/audit-logs/export | auditHandler.ExportAuditLogs | audit.logs.export |
| GET | /api/admin/login-activity | auditHandler.LoginActivity | audit.logs.view |
| GET | /api/admin/security-events | auditHandler.SecurityEvents | audit.logs.view |
| GET | /api/admin/users | adminUsersHandler.List | users.view |
| GET | /api/admin/users/:id | adminUsersHandler.Get | users.view |
| PATCH | /api/admin/users/:id | adminUsersHandler.Update | users.update |

---

### Internal Admin Dashboard Routes — `/api/v1/admin/*`
**Middleware:** RequireAdmin(AdminAPIKey) — shared secret header `x-admin-api-key`  
**⚠️ RISK:** Shared secret; no per-user audit trail; rotate only via redeploy

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | /api/v1/admin/menu-counts | admin.MenuCounts | |
| GET | /api/v1/admin/leads | leads.List | |
| PATCH | /api/v1/admin/leads/:id | leads.UpdateStatus | |
| GET | /api/v1/admin/chatbot/sessions | chats.ListSessions | |
| GET | /api/v1/admin/chatbot/sessions/:id | chats.GetSession | |
| GET | /api/v1/admin/handoffs | handoffs.List | |
| PATCH | /api/v1/admin/handoffs/:id | handoffs.UpdateStatus | |
| GET | /api/v1/admin/analytics/summary | analytics.Summary | |
| GET | /api/v1/admin/competitions/overview | competitions.Overview | |
| GET | /api/v1/admin/competitions/open-mic | competitions.OpenMic | |
| POST | /api/v1/admin/competitions/open-mic | competitions.CreateOpenMic | |
| GET | /api/v1/admin/reality-tv/dashboard | realityTV.Dashboard | |
| GET | /api/v1/public/health | — | Public health check |

---

### STEM Routes — `/api/v1/stem-*`, `/api/v1/schools`
**Middleware:** StemRateLimit (20–120 req/min by endpoint)  
All endpoints available publicly unless noted.

| Method | Path | Handler |
|---|---|---|
| GET | /api/v1/schools | stem.Schools |
| GET | /api/v1/school-profiles | stem.SchoolProfiles |
| GET | /api/v1/school-teams | stem.SchoolTeams |
| GET | /api/v1/emerging-innovators | stem.EmergingInnovators |
| GET | /api/v1/emerging-teams | stem.EmergingTeams |
| GET | /api/v1/emerging-projects | stem.EmergingProjects |
| GET | /api/v1/stem-contests | stem.Contests |
| POST | /api/v1/stem-eligibility/check | stem.CheckEligibility |
| GET | /api/v1/stem-leaderboard | stem.Leaderboard |
| GET | /api/v1/stem-leaderboard/slices | stem.LeaderboardSlices |
| GET | /api/v1/stem-submissions | stem.Submissions |
| GET/POST | /api/v1/stem-judging/scores | stem.JudgingScores / CreateJudgingScore |
| PATCH | /api/v1/stem-judging/scores/:id/review-state | stem.UpdateJudgingScoreReviewState |
| GET/POST | /api/v1/stem-judging/rubrics | stem.JudgingRubrics / CreateJudgingRubric |
| GET | /api/v1/stem-judging/criteria | stem.JudgingCriteria |
| GET/POST | /api/v1/stem-judging/assignments | stem.JudgeAssignments / CreateJudgeAssignment |
| PATCH | /api/v1/stem-judging/assignments/:id/conflict | stem.UpdateJudgeAssignmentConflict |
| GET/POST | /api/v1/stem-voting/rules | stem.VotingRules / UpsertVotingRule |
| GET/POST | /api/v1/stem-voting/packages | stem.VotePackages / CreateVotePackage |
| GET/POST | /api/v1/stem-voting/transactions | stem.VoteTransactions / CreateVoteTransaction |
| GET/POST | /api/v1/stem-bootcamp/cohorts | stem.BootcampCohorts / CreateBootcampCohort |
| GET/POST | /api/v1/stem-bootcamp/tasks | stem.BootcampTasks / CreateBootcampTask |
| GET/POST | /api/v1/stem-bootcamp/scores | stem.BootcampScores / UpsertBootcampScore |
| GET/POST | /api/v1/stem-sponsors | stem.Sponsors / CreateSponsor |
| GET/POST | /api/v1/stem-awards/certificates | stem.Certificates / CreateCertificate |
| GET/POST | /api/v1/stem-awards/badges | stem.Badges / CreateBadge |
| GET/POST | /api/v1/stem-awards/badge-awards | stem.BadgeAwards / AwardBadge |
| GET | /api/v1/stem-reports/summary | stem.ReportSummary |
| GET | /api/v1/stem-reports/buckets | stem.ReportBuckets |

---

## Next.js Frontend API Routes
> Source: `frontend-web/app/api/**/route.ts` (128 route files enumerated below)

### User / Profile
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/me | ✅ JWT | app/api/me/route.ts |
| GET/PATCH | /api/me/profile | ✅ JWT | app/api/me/profile/route.ts |
| GET | /api/me/profile-completion | ✅ JWT | app/api/me/profile-completion/route.ts |
| GET | /api/me/applications | ✅ JWT | app/api/me/applications/route.ts |

### Public Misc
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/contact | None | app/api/contact/route.ts |
| GET | /api/inquiries | None | app/api/inquiries/route.ts |
| GET | /api/opportunities | None | app/api/opportunities/route.ts |
| GET/POST | /api/sponsor-meetings | ✅ JWT | app/api/sponsor-meetings/route.ts |
| GET | /api/leaderboard/[contestId] | None | app/api/leaderboard/[contestId]/route.ts |

### Voting (Universal Engine)
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/vote-page | None | app/api/vote-page/route.ts |
| POST | /api/votes/free | None/JWT | app/api/votes/free/route.ts |
| POST | /api/votes/paid/initiate | None/JWT | app/api/votes/paid/initiate/route.ts |
| POST | /api/votes/paid/verify | None/JWT | app/api/votes/paid/verify/route.ts |
| GET | /api/votes/remaining | None/JWT | app/api/votes/remaining/route.ts |
| GET | /api/votes/stream | None | app/api/votes/stream/route.ts |
| GET | /api/contestant/votes/summary | ✅ JWT | app/api/contestant/votes/summary/route.ts |
| GET | /api/contestant/votes/timeline | ✅ JWT | app/api/contestant/votes/timeline/route.ts |
| GET | /api/contestants/[contestantId]/share | None | app/api/contestants/[contestantId]/share/route.ts |

### Payments & Webhooks
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/webhooks/paystack | None (HMAC) | app/api/webhooks/paystack/route.ts |

### Registration (Contests)
| Method | Path | Auth | File |
|---|---|---|---|
| GET/POST | /api/registration/applications | ✅ JWT | app/api/registration/applications/route.ts |
| GET/PATCH | /api/registration/applications/[id] | ✅ JWT | app/api/registration/applications/[id]/route.ts |
| GET | /api/registration/applications/[id]/status | ✅ JWT | app/api/registration/applications/[id]/status/route.ts |
| POST | /api/registration/applications/[id]/submit | ✅ JWT | app/api/registration/applications/[id]/submit/route.ts |
| POST | /api/registration/applications/[id]/withdraw | ✅ JWT | app/api/registration/applications/[id]/withdraw/route.ts |
| GET | /api/registration/contests | None | app/api/registration/contests/route.ts |
| POST | /api/registration/uploads | ✅ JWT | app/api/registration/uploads/route.ts |
| GET/DELETE | /api/registration/uploads/[fileKey] | ✅ JWT | app/api/registration/uploads/[fileKey]/route.ts |

### Academy
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/academy/apply | ✅ JWT (optional) | app/api/academy/apply/route.ts |
| GET | /api/academy/installments | ✅ JWT | app/api/academy/installments/route.ts |
| POST | /api/academy/installments/pay | ✅ JWT | app/api/academy/installments/pay/route.ts |

### Open Mic
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/open-mic/contests | None | app/api/open-mic/contests/route.ts |
| GET | /api/open-mic/contests/[slug] | None | app/api/open-mic/contests/[slug]/route.ts |
| POST | /api/open-mic/contests/[slug]/apply | ✅ JWT | app/api/open-mic/contests/[slug]/apply/route.ts |
| GET | /api/open-mic/contests/[slug]/beat/download | ✅ JWT | app/api/open-mic/contests/[slug]/beat/download/route.ts |
| GET/POST | /api/open-mic/applications | ✅ JWT | app/api/open-mic/applications/route.ts |
| GET/PATCH | /api/open-mic/submissions | ✅ JWT | app/api/open-mic/submissions/route.ts |
| POST | /api/open-mic/submissions/[id]/submit | ✅ JWT | app/api/open-mic/submissions/[id]/submit/route.ts |
| GET | /api/open-mic/songs/[id] | None | app/api/open-mic/songs/[id]/route.ts |
| POST | /api/open-mic/uploads/presign | ✅ JWT | app/api/open-mic/uploads/presign/route.ts |
| POST | /api/open-mic/uploads/complete | ✅ JWT | app/api/open-mic/uploads/complete/route.ts |
| POST | /api/open-mic/uploads | ✅ JWT | app/api/open-mic/uploads/route.ts |
| POST | /api/open-mic/votes | None/JWT | app/api/open-mic/votes/route.ts |
| GET | /api/open-mic/votes/stream | None | app/api/open-mic/votes/stream/route.ts |
| POST | /api/open-mic/votes/pay/initiate | None/JWT | app/api/open-mic/votes/pay/initiate/route.ts |
| POST | /api/open-mic/votes/pay/verify | None/JWT | app/api/open-mic/votes/pay/verify/route.ts |
| GET | /api/open-mic/profile | ✅ JWT | app/api/open-mic/profile/route.ts |

### STEM
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/stem/contests | None | app/api/stem/contests/route.ts |
| GET | /api/stem/contests/[slug] | None | app/api/stem/contests/[slug]/route.ts |
| GET/POST | /api/stem/applications | ✅ JWT | app/api/stem/applications/route.ts |
| GET/PATCH | /api/stem/applications/[id] | ✅ JWT | app/api/stem/applications/[id]/route.ts |
| GET | /api/stem/applications/[id]/status | ✅ JWT | app/api/stem/applications/[id]/status/route.ts |
| POST | /api/stem/applications/[id]/submit | ✅ JWT | app/api/stem/applications/[id]/submit/route.ts |
| GET/POST | /api/stem/schools | ✅ JWT | app/api/stem/schools/route.ts |
| GET | /api/stem/schools/[id]/review | ✅ JWT | app/api/stem/schools/[id]/review/route.ts |
| GET/POST | /api/stem/school-join-requests | ✅ JWT | app/api/stem/school-join-requests/route.ts |
| PATCH | /api/stem/school-join-requests/[id]/review | ✅ JWT | app/api/stem/school-join-requests/[id]/review/route.ts |

### Admin — Contests
| Method | Path | Auth | File |
|---|---|---|---|
| GET/POST | /api/admin/contests | Admin | app/api/admin/contests/route.ts |
| GET/PATCH | /api/admin/contests/[slug] | Admin | app/api/admin/contests/[slug]/route.ts |

### Admin — Voting
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/admin/voting/[contestId]/leaderboard | Admin | app/api/admin/voting/[contestId]/leaderboard/route.ts |
| GET | /api/admin/voting/[contestId]/revenue | Admin | app/api/admin/voting/[contestId]/revenue/route.ts |
| POST | /api/admin/voting/[contestId]/freeze | Admin | app/api/admin/voting/[contestId]/freeze/route.ts |
| GET | /api/admin/voting/[contestId]/fraud-alerts | Admin | app/api/admin/voting/[contestId]/fraud-alerts/route.ts |
| GET/POST | /api/admin/voting/[contestId]/adjust | Admin | app/api/admin/voting/[contestId]/adjust/route.ts |
| GET | /api/admin/voting/[contestId]/export | Admin | app/api/admin/voting/[contestId]/export/route.ts |
| GET | /api/admin/voting/[contestId]/transactions | Admin | app/api/admin/voting/[contestId]/transactions/route.ts |
| GET | /api/admin/voting/packages | Admin | app/api/admin/voting/packages/route.ts |
| GET | /api/admin/voting/settings | Admin | app/api/admin/voting/settings/route.ts |
| GET | /api/admin/voting/rounds | Admin | app/api/admin/voting/rounds/route.ts |
| POST | /api/admin/voting/votes/[voteId]/reverse | Admin | app/api/admin/voting/votes/[voteId]/reverse/route.ts |

### Admin — Registration / Applications
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/admin/registration/applications | Admin | app/api/admin/registration/applications/route.ts |
| GET | /api/admin/registration/applications/[id]/review | Admin | app/api/admin/registration/applications/[id]/review/route.ts |
| POST | /api/admin/applications/bulk-action | Admin | app/api/admin/applications/bulk-action/route.ts |

### Admin — Open Mic
| Method | Path | Auth | File |
|---|---|---|---|
| GET/POST | /api/admin/open-mic/contests | Admin | app/api/admin/open-mic/contests/route.ts |
| GET/PATCH | /api/admin/open-mic/contests/[id] | Admin | app/api/admin/open-mic/contests/[id]/route.ts |
| GET | /api/admin/open-mic/contests/[id]/applications | Admin | app/api/admin/open-mic/contests/[id]/applications/route.ts |
| GET | /api/admin/open-mic/contests/[id]/submissions | Admin | (via open-mic/submissions/route.ts) |
| GET/POST | /api/admin/open-mic/contests/[id]/beats | Admin | app/api/admin/open-mic/contests/[id]/beats/route.ts |
| GET | /api/admin/open-mic/contests/[id]/beat-downloads | Admin | app/api/admin/open-mic/contests/[id]/beat-downloads/route.ts |
| GET/POST | /api/admin/open-mic/contests/[id]/playlist | Admin | app/api/admin/open-mic/contests/[id]/playlist/route.ts |
| PATCH | /api/admin/open-mic/contests/[id]/playlist/[submissionId] | Admin | app/api/admin/open-mic/contests/[id]/playlist/[submissionId]/route.ts |
| POST | /api/admin/open-mic/contests/[id]/playlist/autobuild | Admin | app/api/admin/open-mic/contests/[id]/playlist/autobuild/route.ts |
| POST | /api/admin/open-mic/contests/[id]/playlist/lock | Admin | app/api/admin/open-mic/contests/[id]/playlist/lock/route.ts |
| GET | /api/admin/open-mic/contests/[id]/votes | Admin | app/api/admin/open-mic/contests/[id]/votes/route.ts |
| GET/POST | /api/admin/open-mic/contests/[id]/finalists | Admin | app/api/admin/open-mic/contests/[id]/finalists/route.ts |
| GET/POST | /api/admin/open-mic/contests/[id]/winner | Admin | app/api/admin/open-mic/contests/[id]/winner/route.ts |
| GET | /api/admin/open-mic/contests/[id]/winners | Admin | app/api/admin/open-mic/contests/[id]/winners/route.ts |
| GET | /api/admin/open-mic/contests/[id]/payments | Admin | app/api/admin/open-mic/contests/[id]/payments/route.ts |
| GET | /api/admin/open-mic/contests/[id]/reports | Admin | app/api/admin/open-mic/contests/[id]/reports/route.ts |
| GET/POST | /api/admin/open-mic/contests/[id]/notifications | Admin | app/api/admin/open-mic/contests/[id]/notifications/route.ts |
| GET | /api/admin/open-mic/contests/[id]/moderation-actions | Admin | app/api/admin/open-mic/contests/[id]/moderation-actions/route.ts |
| GET | /api/admin/open-mic/contests/[id]/fraud-alerts | Admin | app/api/admin/open-mic/contests/[id]/fraud-alerts/route.ts |
| GET | /api/admin/open-mic/contests/[id]/finale | Admin | app/api/admin/open-mic/contests/[id]/finale/route.ts |
| GET | /api/admin/open-mic/applications | Admin | app/api/admin/open-mic/applications/route.ts |
| GET | /api/admin/open-mic/applications/[id]/review | Admin | app/api/admin/open-mic/applications/[id]/review/route.ts |
| GET/POST | /api/admin/open-mic/submissions | Admin | app/api/admin/open-mic/submissions/route.ts |
| GET/PATCH | /api/admin/open-mic/submissions/[id]/review | Admin | app/api/admin/open-mic/submissions/[id]/review/route.ts |
| GET/PATCH | /api/admin/open-mic/submissions/[id]/song | Admin | app/api/admin/open-mic/submissions/[id]/song/route.ts |

### Admin — STEM
| Method | Path | Auth | File |
|---|---|---|---|
| GET/POST | /api/admin/stem/contests | Admin | app/api/admin/stem/contests/route.ts |
| GET/PATCH | /api/admin/stem/contests/[id] | Admin | app/api/admin/stem/contests/[id]/route.ts |
| POST | /api/admin/stem/contests/[id]/publish | Admin | app/api/admin/stem/contests/[id]/publish/route.ts |
| GET/POST | /api/admin/stem/contests/[id]/categories | Admin | app/api/admin/stem/contests/[id]/categories/route.ts |
| GET/POST | /api/admin/stem/contests/[id]/prices | Admin | app/api/admin/stem/contests/[id]/prices/route.ts |
| GET/POST | /api/admin/stem/contests/[id]/prizes | Admin | app/api/admin/stem/contests/[id]/prizes/route.ts |
| GET | /api/admin/stem/applications | Admin | app/api/admin/stem/applications/route.ts |
| GET | /api/admin/stem/applications/[id]/review | Admin | app/api/admin/stem/applications/[id]/review/route.ts |

### Admin — Academy
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/admin/academy/applications | Admin | app/api/admin/academy/applications/route.ts |
| GET/PATCH | /api/admin/academy/applications/[id] | Admin | app/api/admin/academy/applications/[id]/route.ts |
| GET/POST | /api/admin/academy/batches | Admin | app/api/admin/academy/batches/route.ts |
| GET/PATCH | /api/admin/academy/batches/[id] | Admin | app/api/admin/academy/batches/[id]/route.ts |
| GET | /api/admin/academy/installments | Admin | app/api/admin/academy/installments/route.ts |
| GET | /api/admin/academy/installments/[planId]/remind | Admin | app/api/admin/academy/installments/[planId]/remind/route.ts |
| GET | /api/admin/academy/settings | Admin | app/api/admin/academy/settings/route.ts |

### Admin — Reality Show
| Method | Path | Auth | File |
|---|---|---|---|
| GET/POST | /api/admin/reality-show/seasons | Admin | app/api/admin/reality-show/seasons/route.ts |
| GET/PATCH | /api/admin/reality-show/seasons/[id] | Admin | app/api/admin/reality-show/seasons/[id]/route.ts |
| GET/POST | /api/admin/reality-show/seasons/[id]/contestants | Admin | app/api/admin/reality-show/seasons/[id]/contestants/route.ts |
| GET/POST | /api/admin/reality-show/seasons/[id]/weeks | Admin | app/api/admin/reality-show/seasons/[id]/weeks/route.ts |
| GET/PATCH | /api/admin/reality-show/contestants/[id] | Admin | app/api/admin/reality-show/contestants/[id]/route.ts |
| GET/POST | /api/admin/reality-show/weeks/[id]/vote | Admin | app/api/admin/reality-show/weeks/[id]/vote/route.ts |
| PATCH | /api/admin/reality-show/weeks/[id]/status | Admin | app/api/admin/reality-show/weeks/[id]/status/route.ts |
| POST | /api/admin/reality-show/weeks/[id]/evict | Admin | app/api/admin/reality-show/weeks/[id]/evict/route.ts |

### Admin — Platform
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/admin/dashboard | Admin | app/api/admin/dashboard/route.ts |
| GET | /api/admin/users-roles | Admin | app/api/admin/users-roles/route.ts |
| GET | /api/admin/audit-logs | Admin | app/api/admin/audit-logs/route.ts |
| GET | /api/admin/settings | Admin | app/api/admin/settings/route.ts |
| GET | /api/admin/reports | Admin | app/api/admin/reports/route.ts |
| GET/POST | /api/admin/programs | Admin | app/api/admin/programs/route.ts |
| GET/PATCH/DELETE | /api/admin/programs/[id] | Admin | app/api/admin/programs/[id]/route.ts |
| GET/POST | /api/admin/cms | Admin | app/api/admin/cms/route.ts |
| GET/PATCH/DELETE | /api/admin/cms/[id] | Admin | app/api/admin/cms/[id]/route.ts |
| GET/POST | /api/admin/events | Admin | app/api/admin/events/route.ts |
| GET/PATCH | /api/admin/events/[id] | Admin | app/api/admin/events/[id]/route.ts |
| POST | /api/admin/notifications | Admin | app/api/admin/notifications/route.ts |
| GET/POST | /api/admin/judges-scores | Admin | app/api/admin/judges-scores/route.ts |
| POST | /api/admin/judges-scores/applications/[id]/score | Admin | app/api/admin/judges-scores/applications/[id]/score/route.ts |

---

## Middleware-Protected Frontend Routes
> Source: frontend-web/src/middleware.ts

All patterns redirect unauthenticated users to `/login?next={pathname}`:

| Pattern | Protected Resource |
|---|---|
| `/admin(?:/\|$)` | Admin dashboard |
| `/apply(?:/\|$)` | Contest application flow |
| `/film-academy(?:/\|$)` | Academy dashboard |
| `/open-mic/[^/]+/apply(?:/\|$)` | Open Mic application |
| `/open-mic/[^/]+/enter(?:/\|$)` | Open Mic entry |
| `/stem/contests(?:/\|$)` | STEM competition pages |
| `/contestant(?:/\|$)` | Contestant dashboard |
| `/user-dashboard(?:/\|$)` | User dashboard |
| `/profile(?:/\|$)` | Profile edit |
| `/my-applications(?:/\|$)` | Applications list |

---

---

## Legacy Module File Map
> These are the exact paths the CLAUDE.md brownfield rules protect. The PreToolUse hook blocks edits to these files.

### Contests Module
```
Database (migrations — do not alter existing columns):
  supabase/migrations/20260404210000_create_contests.sql   # public.contests table
  supabase/migrations/20260404220000_create_contestants.sql # public.contestants table
  supabase/migrations/20260404230000_contestant_module_full.sql  # contestant full schema

Server-side logic:
  frontend-web/src/server/services/academy/service.ts      # academy service (contest-adjacent)

API routes (read-only references OK; wrapping via adapters required):
  frontend-web/app/api/registration/applications/route.ts
  frontend-web/app/api/registration/applications/[id]/route.ts
  frontend-web/app/api/admin/contests/route.ts
  frontend-web/app/api/admin/contests/[slug]/route.ts
```

### Voting Module — Legacy Engine (DEPRECATED, NOT REMOVED)
```
Database (immutable — these tables still receive data from legacy paths):
  supabase/migrations/20260404240000_voting_engine.sql     # contestant_votes, vote_allocations,
                                                            # cast_free_vote(), cast_paid_votes(),
                                                            # cast_referral_vote() RPCs
  supabase/migrations/20260404250000_fraud_detection.sql   # ip_velocity_tracking, device_tracking,
                                                            # vote_fraud_logs, run_fraud_checks() RPC
  supabase/migrations/20260405500000_fix_vote_allocations_constraint.sql  # constraint fix

Seed:
  supabase/seed_voting_engine.sql
```

### Voting Module — Universal Engine (ACTIVE — wrap, do not rewrite)
```
Database:
  supabase/migrations/20260602100000_universal_voting_engine.sql  # votes, vote_transactions,
                                                                    # vote_totals, voter_profiles,
                                                                    # voter_daily_limits, voting_settings
  supabase/migrations/20260602110000_voting_rpc_functions.sql      # increment_vote_totals(),
                                                                    # recompute_leaderboard_ranks()
  supabase/migrations/20260602120000_contestant_voting_slug.sql    # voting_link_slug UNIQUE

Server-side logic (the vote-recording functions — bridge wraps these):
  frontend-web/src/server/voting/free-vote.service.ts      # castFreeVote() — NOT idempotent ⚠️
  frontend-web/src/server/voting/paid-vote.service.ts      # verifyAndCreditPaidVote() — TOCTOU race ⚠️
  frontend-web/src/server/voting/totals.service.ts         # incrementVoteTotals()
  frontend-web/src/server/voting/fraud.service.ts          # scoreFreeFraud()
  frontend-web/src/server/voting/audit.service.ts          # appendAuditLog()
  frontend-web/src/server/voting/email.service.ts          # sendVoteReceiptEmail() (fire-and-forget)
  frontend-web/src/server/voting/share.service.ts          # share link utilities
  frontend-web/src/server/voting/milestone.service.ts      # vote milestone tracking
  frontend-web/src/server/voting/payment/paystack.ts       # Paystack API client
  frontend-web/src/server/voting/payment/webhook.ts        # webhook HMAC verification

API routes:
  frontend-web/app/api/votes/free/route.ts                 # calls castFreeVote()
  frontend-web/app/api/votes/paid/initiate/route.ts        # calls initiatePaidVote()
  frontend-web/app/api/votes/paid/verify/route.ts          # calls verifyAndCreditPaidVote()
  frontend-web/app/api/webhooks/paystack/route.ts          # webhook → verifyAndCreditPaidVote()
  frontend-web/app/api/votes/remaining/route.ts
  frontend-web/app/api/votes/stream/route.ts
```

### Auth Module
```
Frontend middleware (session refresh + route guard):
  frontend-web/src/middleware.ts                           # PROTECTED_PATTERNS, Supabase SSR

Auth utility library:
  frontend-web/src/lib/auth/client.ts                     # Supabase client-side auth
  frontend-web/src/lib/auth/server.ts                     # requireAdmin(), requireUser()
  frontend-web/src/lib/auth/request.ts                    # requireRequestUser() — Bearer token validation
  frontend-web/src/lib/auth/flow.ts                       # Auth flow helpers

Backend auth (Go):
  backend/internal/middleware/auth_context.go             # JWT verification + RBAC load
  backend/internal/middleware/authorization.go            # RequirePermission middleware
  backend/internal/middleware/admin_auth.go               # x-admin-api-key check (shared secret)
  backend/internal/services/auth_service.go               # Auth service layer
  backend/internal/domain/auth_rbac.go                    # RBAC domain models

RBAC database:
  supabase/migrations/20260527100000_enterprise_auth_rbac.sql  # roles, permissions, user_roles,
                                                                # user_permissions, platform_users,
                                                                # auth_sessions, audit_logs,
                                                                # effective_permissions(), user_has_permission()
```

### Applicants / Registration Module
```
Database:
  supabase/migrations/20260423113000_applicant_dashboard_core.sql  # applicant_notifications,
                                                                     # application_status_history

Server logic:
  frontend-web/src/server/registration/store.ts            # Registration state store
  frontend-web/src/data/programApplications.js             # Static program application data
  frontend-web/src/data/programPages.js                    # Static program page data
  frontend-web/src/features/registration/config.ts         # Registration flow config

API routes:
  frontend-web/app/api/registration/applications/route.ts
  frontend-web/app/api/registration/applications/[id]/route.ts
  frontend-web/app/api/registration/applications/[id]/submit/route.ts
  frontend-web/app/api/registration/applications/[id]/withdraw/route.ts
  frontend-web/app/api/registration/applications/[id]/status/route.ts
  frontend-web/app/api/registration/contests/route.ts
  frontend-web/app/api/registration/uploads/route.ts
  frontend-web/app/api/registration/uploads/[fileKey]/route.ts
```

---

### Vote-Recording Idempotency — Source-Code Verdict

**Reviewed:** 2026-06-13 | **Files read:** free-vote.service.ts, paid-vote.service.ts

| Function | File | Idempotent | Mechanism | Remaining Risk |
|---|---|---|---|---|
| `castFreeVote()` | `src/server/voting/free-vote.service.ts:119` | ❌ NO | `voter_daily_limits` upsert reads `free_votes_used`, inserts into `votes`, then updates counter — TOCTOU race between read and update | Two concurrent identical requests pass the limit check simultaneously; both insert separate vote rows; both update the counter to `used + canAdd` independently. No unique constraint or `INSERT ... ON CONFLICT` guard on the `votes` table. |
| `verifyAndCreditPaidVote()` | `src/server/voting/paid-vote.service.ts:152` | ⚠️ PARTIAL | Early-return if `vote_credit_status === 'credited'` (line 171) prevents double-credit in the happy path | No `SELECT FOR UPDATE` on the `vote_transactions` row. Two concurrent calls (webhook + browser redirect) both read `credit_status = 'pending'`, both pass the guard, both `UPDATE` to `credited` and both `INSERT` a vote row. The comment on line 151 says "Idempotent" — that is aspirational, not actual. |
| `incrementVoteTotals()` | `src/server/voting/totals.service.ts` | ✅ YES | Uses `UPSERT` into `vote_totals` with `ON CONFLICT DO UPDATE SET ... + EXCLUDED` | Still called outside the vote insert transaction — crash between insert and increment leaves totals stale. |

**Bottom line:** Neither vote-recording function in the active code path is fully idempotent. The voting bridge (PRD §10.3) MUST add an `INSERT ... ON CONFLICT DO NOTHING` with a unique key on the `votes` table, and a `SELECT FOR UPDATE` on `vote_transactions` before any wallet debit is wired.

---

## Gaps & Risks

| Gap | Risk | Impact |
|---|---|---|
| No `/api/v2/` namespace | PRD requires v2 for all fintech endpoints without breaking v1 | Needs new route group before fintech build |
| `/api/webhooks/paystack` has no rate limit | Webhook flood could cause DoS | Add rate limiter + IP allowlist for Paystack ranges |
| STEM endpoints publicly writable (POST/PATCH) | No auth on score/assignment mutations | Needs RequireAuthContext + role check |
| `/api/v1/admin/*` uses shared API key | All admin ops share one identity; no per-user audit | Migrate to JWT + RequirePermission |
| No `/api/v1/public/health` in frontend | Deployment health check is backend-only | Add frontend health endpoint |
| No idempotency key enforcement at HTTP layer | Must be added to all fintech mutation endpoints | Middleware needed |
