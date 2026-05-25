import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { listRegistrationApplications, startRegistrationDraft } from '@/src/server/registration/store';
import type { RegistrationListFilter } from '@/src/features/registration/types';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter: RegistrationListFilter = {
      contestSlug: searchParams.get('contestSlug') || undefined,
      status: (searchParams.get('status') as RegistrationListFilter['status']) || undefined,
      contestCategory: (searchParams.get('contestCategory') as RegistrationListFilter['contestCategory']) || undefined,
      paymentStatus: (searchParams.get('paymentStatus') as RegistrationListFilter['paymentStatus']) || undefined,
      query: searchParams.get('query') || undefined,
    };

    if (searchParams.get('minAge')) filter.minAge = Number(searchParams.get('minAge'));
    if (searchParams.get('maxAge')) filter.maxAge = Number(searchParams.get('maxAge'));

    const applications = listRegistrationApplications(filter);
    return successResponse({ success: true, applications });
  } catch (error) {
    return handleApiError(error, 'Failed to list registration applications');
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      contestSlug?: string;
      userId?: string;
      role?: 'public_user' | 'contestant' | 'parent_guardian' | 'school_representative' | 'admin' | 'super_admin';
      accountData?: Record<string, unknown>;
    };

    if (!body?.contestSlug) {
      return errorResponse('contestSlug is required', 400);
    }

    const draft = startRegistrationDraft({
      contestSlug: body.contestSlug,
      userId: body.userId,
      role: body.role,
      accountData: body.accountData,
    });

    return successResponse({ success: true, draft }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create registration draft');
  }
}
