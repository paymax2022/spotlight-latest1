import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { listApplications, startApplication } from '@/src/server/stem/persistence';
import type { StemApplicationFilter, StemApplicantType, StemParticipationTrack } from '@/src/features/stem/types';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter: StemApplicationFilter = {
      contestId: searchParams.get('contestId') || undefined,
      contestSlug: searchParams.get('contestSlug') || undefined,
      status: (searchParams.get('status') as StemApplicationFilter['status']) || undefined,
      applicantType: (searchParams.get('applicantType') as StemApplicationFilter['applicantType']) || undefined,
      track: (searchParams.get('track') as StemApplicationFilter['track']) || undefined,
      schoolId: searchParams.get('schoolId') || undefined,
      paymentStatus: (searchParams.get('paymentStatus') as StemApplicationFilter['paymentStatus']) || undefined,
      state: searchParams.get('state') || undefined,
      query: searchParams.get('query') || undefined,
    };

    const applications = await listApplications(filter);
    return successResponse({ success: true, applications });
  } catch (error) {
    return handleApiError(error, 'Failed to list STEM applications');
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      contestSlug?: string;
      track?: StemParticipationTrack;
      applicantType?: StemApplicantType;
      schoolId?: string;
      schoolJoinRequestId?: string;
      applicantUserId?: string;
      applicantName?: string;
      applicantEmail?: string;
      applicantPhone?: string;
    };

    if (!body.contestSlug) return errorResponse('contestSlug is required', 400);
    if (!body.track) return errorResponse('track is required', 400);
    if (!body.applicantType) return errorResponse('applicantType is required', 400);

    const result = await startApplication({
      contestSlug: body.contestSlug,
      track: body.track,
      applicantType: body.applicantType,
      schoolId: body.schoolId,
      schoolJoinRequestId: body.schoolJoinRequestId,
      applicantUserId: body.applicantUserId,
      applicantName: body.applicantName,
      applicantEmail: body.applicantEmail,
      applicantPhone: body.applicantPhone,
    });

    if (!result.success) {
      return successResponse(result, 400);
    }

    return successResponse(result, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to start STEM application');
  }
}
