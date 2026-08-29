import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
// ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047): registration/store is
// the in-memory version nothing real ever writes to — real applications live
// in Supabase (registration/supabase-store). This route backs the Judges &
// Scores console shipped over Path A in slice 4; it was scoring against an
// applicant list that was always empty.
import { listRegistrationApplications } from '@/src/server/registration/supabase-store';
import { getScoreSummary, getScoredApplicationIds, getRubricForContest } from '@/src/server/services/scoring/store';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'scores:manage');
    const { searchParams } = new URL(request.url);
    const contestSlug  = searchParams.get('contestSlug') || undefined;
    const statusFilter = searchParams.get('status') || undefined;
    const query        = searchParams.get('query') || '';

    // Pull submitted/under-review/shortlisted applications eligible for judge scoring
    const SCOREABLE_STATUSES = ['submitted', 'under_review', 'shortlisted', 'callback_invited', 'approved'];

    let apps = (await listRegistrationApplications({
      contestSlug,
      status: statusFilter as never ?? undefined,
    })).filter((a) => SCOREABLE_STATUSES.includes(a.status));

    if (query) {
      const q = query.toLowerCase();
      apps = apps.filter((a) => {
        const name  = String(a.formData['personal.firstName'] ?? a.formData['account.fullName'] ?? '').toLowerCase();
        const email = String(a.formData['account.email'] ?? a.formData['personal.email'] ?? '').toLowerCase();
        return a.reference.toLowerCase().includes(q) || name.includes(q) || email.includes(q);
      });
    }

    const scoredIds = await getScoredApplicationIds();

    const enriched = await Promise.all(apps.map(async (a) => {
      const summary = await getScoreSummary(a.id);
      const rubric  = getRubricForContest(a.contestSlug);
      return {
        id:           a.id,
        reference:    a.reference,
        contestSlug:  a.contestSlug,
        status:       a.status,
        isScored:     scoredIds.has(a.id),
        fullName:     String(a.formData['personal.firstName'] ?? a.formData['account.fullName'] ?? '').trim()
                      + ' ' + String(a.formData['personal.lastName'] ?? '').trim(),
        email:        String(a.formData['account.email'] ?? a.formData['personal.email'] ?? ''),
        primarySkill: String(a.formData['talent.primarySkill'] ?? a.formData['contest.applicantCategory'] ?? ''),
        state:        String(a.formData['personal.stateOfResidence'] ?? a.formData['account.state'] ?? ''),
        scoreSummary: summary,
        rubric,
        formData:     a.formData,
        createdAt:    a.createdAt,
        updatedAt:    a.updatedAt,
      };
    }));

    // Stats
    const total   = enriched.length;
    const scored  = enriched.filter((a) => a.isScored).length;
    const pending = total - scored;

    return successResponse({ applications: enriched, stats: { total, scored, pending } });
  } catch (error) {
    return handleApiError(error, 'Failed to list applications for scoring');
  }
}
