import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { listRegistrationApplications } from '@/src/server/registration/store';
import { listSubmissions, listContests as listOpenMicContests } from '@/src/server/openmic/store';
import { listStemApplications, listStemAdminContests } from '@/src/server/stem/store';

export async function GET(request: Request) {
  try {
    assertAdminPermission(request, 'reports:export');

    const registrations = listRegistrationApplications();
    const openMicSubmissions = listSubmissions();
    const openMicContests = listOpenMicContests({ includeNonPublic: true });
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

