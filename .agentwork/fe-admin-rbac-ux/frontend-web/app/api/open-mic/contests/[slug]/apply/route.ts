import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createApplication, getContestBySlug } from '@/src/server/openmic/persistence';
import { requireRequestUser } from '@/src/lib/auth/request';

export async function POST(request: Request, context: { params: { slug: string } }) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as any;
    const contest = await getContestBySlug(context.params.slug);
    if (!contest) return errorResponse('Contest not found', 404);

    const requiredFields = ['fullName', 'stageName', 'email', 'phone', 'country', 'state', 'lga'];
    for (const key of requiredFields) {
      if (!String(body?.[key] || '').trim()) return errorResponse(`${key} is required`, 400);
    }
    const hasSocialHandle = [
      body.instagramHandle,
      body.tiktokHandle,
      body.youtubeHandle,
      body.facebookHandle,
      body.xHandle,
    ].some((value) => String(value || '').trim());
    if (!hasSocialHandle) return errorResponse('At least one social media handle is required', 400);
    if (!body.hasAgreedToRules || !body.hasAgreedToBeatTerms || !body.hasAgreedToVotingTerms) {
      return errorResponse('Rules, beat terms, and voting terms must be accepted.', 400);
    }

    const result = await createApplication({
      contestSlug: context.params.slug,
      userId: user.id,
      fullName: String(body.fullName || '').trim(),
      stageName: String(body.stageName || '').trim(),
      email: String(body.email || '').trim(),
      phone: String(body.phone || '').trim(),
      gender: body.gender || 'prefer_not_to_say',
      ageRange: body.ageRange || '18_24',
      country: String(body.country || '').trim(),
      city: String(body.city || '').trim(),
      state: String(body.state || '').trim(),
      lga: String(body.lga || '').trim(),
      instagramHandle: String(body.instagramHandle || '').trim() || undefined,
      tiktokHandle: String(body.tiktokHandle || '').trim() || undefined,
      youtubeHandle: String(body.youtubeHandle || '').trim() || undefined,
      facebookHandle: String(body.facebookHandle || '').trim() || undefined,
      xHandle: String(body.xHandle || '').trim() || undefined,
      musicGenre: '',
      artistBio: body.artistBio,
      profilePhotoUrl: body.profilePhotoUrl,
      hasAgreedToRules: true,
      hasAgreedToBeatTerms: true,
      hasAgreedToVotingTerms: true,
      paymentStatus: contest.entryFeeRequired ? 'pending' : 'not_required',
    });

    if (!result.success) return successResponse(result, 400);
    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    const message =
      (error instanceof Error ? error.message : undefined) ||
      (typeof error === 'object' && error && 'message' in error && typeof (error as any).message === 'string'
        ? (error as any).message
        : undefined) ||
      'Failed to apply for open mic contest';
    return handleApiError(new Error(message), message);
  }
}
