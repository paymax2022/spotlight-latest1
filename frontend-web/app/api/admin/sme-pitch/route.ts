import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
// ADMIN CONSOLIDATION (see docs/adr/ADR-047): frontend-web/app/admin/(dashboard)/
// sme-pitch/page.tsx read registration/store (in-memory, nothing real ever
// writes to) directly — a second, undiscovered instance of the same dead-store
// bug slice 5 fixed for the main registration/dashboard/reports routes. This
// is the Path A API route that console never had: real contests (Postgres,
// same merge as GET /api/admin/contests) and real applications
// (registration/supabase-store), filtered to contestCategory 'sme_pitch'.
import { listRegistrationContests } from '@/src/server/registration/store';
import { listRegistrationApplications } from '@/src/server/registration/supabase-store';
import { listPersistedContests } from '@/src/server/registration-v2/contest-store';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');

    const persisted = (await listPersistedContests()).filter((c) => c.contestCategory === 'sme_pitch');
    const seen = new Set(persisted.map((c) => c.slug));
    const legacy = listRegistrationContests().filter((c) => c.contestCategory === 'sme_pitch' && !seen.has(c.slug));
    const contests = [...persisted, ...legacy];

    const applications = await listRegistrationApplications({ contestCategory: 'sme_pitch' });
    const contestSlugs = new Set(contests.map((c) => c.slug));

    const stats = {
      contests: contests.length,
      applications: applications.length,
      submitted: applications.filter((a) => a.status !== 'draft').length,
      shortlisted: applications.filter((a) => ['shortlisted', 'approved', 'selected_for_bootcamp'].includes(a.status)).length,
    };

    return successResponse({
      contests,
      applications: applications.map((a) => ({
        id: a.id,
        reference: a.reference,
        contestSlug: a.contestSlug,
        status: a.status,
        fullName: String(a.formData['personal.firstName'] ?? a.formData['account.fullName'] ?? '').trim(),
        email: String(a.formData['account.email'] ?? a.formData['personal.email'] ?? ''),
        paymentStatus: String(a.formData['payment.paymentStatus'] ?? ''),
        knownContest: contestSlugs.has(a.contestSlug),
        contestTitle: String(a.formData['contest.title'] ?? a.contestSlug),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
      stats,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load SME Pitch console data');
  }
}
