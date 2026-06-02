import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listApplications } from '@/src/server/openmic/persistence';

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    await assertOpenMicReadAdmin(request);
    const applications = await listApplications({ contestId: context.params.id });
    return successResponse({
      success: true,
      applications: applications.map((row) => ({
        id: row.id,
        artistName: row.fullName,
        stageName: row.stageName,
        email: row.email,
        phone: row.phone,
        applicationStatus: row.applicationStatus,
        paymentStatus: row.paymentStatus,
        beatDownloadStatus: row.beatDownloadStatus,
        songSubmissionStatus: 'not_submitted',
        voteCount: 0,
        qualificationStatus: 'not_qualified',
        appliedAt: row.appliedAt,
      })),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to list applications');
  }
}
