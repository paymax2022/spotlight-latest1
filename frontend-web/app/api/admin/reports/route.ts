import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
// ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047): registration/store is
// the in-memory version nothing real ever writes to — real applications live
// in Supabase (registration/supabase-store), same fix as the openmic import
// above. listRegistrationApplications here is async and its filter argument
// is required (not optional), unlike the memory version.
import { listRegistrationApplications } from '@/src/server/registration/supabase-store';
// ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047): the in-memory openmic/store
// import is never written to by any real flow; every open-mic admin page and API
// route reads openmic/persistence (Supabase-backed) instead. persistence.ts is
// async where store.ts was sync — both calls below are awaited accordingly.
import { listSubmissions, listContests as listOpenMicContests } from '@/src/server/openmic/persistence';
import { listStemApplications, listStemAdminContests } from '@/src/server/stem/store';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'reports:export');

    const registrations = await listRegistrationApplications({});
    const openMicSubmissions = await listSubmissions();
    const openMicContests = await listOpenMicContests({ includeNonPublic: true });
    const stemApplications = listStemApplications();
    const stemContests = listStemAdminContests();

    const report = {
      generatedAt: new Date().toISOString(),
      programs: {
        openMicContests: openMicContests.length,
        stemContests: stemContests.length,
      },
      applications: {
        total: registrations.length + stemApplications.length,
        registration: registrations.length,
        stem: stemApplications.length,
        approved:
          registrations.filter((x) => x.status === 'approved' || x.status === 'shortlisted').length +
          stemApplications.filter((x) => x.status === 'approved' || x.status === 'shortlisted').length,
        rejected:
          registrations.filter((x) => x.status === 'rejected').length +
          stemApplications.filter((x) => x.status === 'rejected').length,
      },
      openMic: {
        submissions: openMicSubmissions.length,
        approved: openMicSubmissions.filter((x) => x.status === 'approved' || x.status === 'published_for_voting').length,
        finalists: openMicSubmissions.filter((x) => x.isFinalist).length,
      },
      finance: {
        paidRegistrationCount: registrations.filter((x) => String(x.formData['payment.paymentStatus']) === 'paid').length,
        awaitingPaymentCount: registrations.filter((x) => String(x.formData['payment.paymentStatus']) === 'pending').length,
      },
    };

    return successResponse({ success: true, report });
  } catch (error) {
    return handleApiError(error, 'Failed to generate report');
  }
}

