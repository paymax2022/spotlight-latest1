import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { listRegistrationApplications, startRegistrationDraft } from '@/src/server/registration/supabase-store';
import type { RegistrationListFilter } from '@/src/features/registration/types';
import { requireUser } from '@/src/lib/auth/server';
import { getOrCreateUserProfile } from '@/src/server/user/profile';
import { buildAccountPrefill } from '@/src/features/registration/account-prefill';

export async function GET(request: Request) {
  try {
    const { user } = await requireUser(request);
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

    const applications = (await listRegistrationApplications(filter)).filter((draft) => draft.userId === user.id);
    return successResponse({ success: true, applications });
  } catch (error) {
    return handleApiError(error, 'Failed to list registration applications');
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json()) as {
      contestSlug?: string;
      userId?: string;
      role?: 'public_user' | 'contestant' | 'parent_guardian' | 'school_representative' | 'admin' | 'super_admin';
      accountData?: Record<string, unknown>;
    };

    if (!body?.contestSlug) {
      return errorResponse('contestSlug is required', 400);
    }

    // registrations.role is DB-constrained to public_user|invited_applicant|staff
    // (see 20260811232202 CHECK) — fold the app's wider role set onto it.
    const storeRole =
      body.role === 'admin' || body.role === 'super_admin' ? 'staff' : 'public_user';

    // Seed the draft with what the applicant already gave at sign-up, so no
    // contest form asks for their name, phone or contact details again. Resolved
    // server-side from the profile — never from the request — and a failure here
    // only costs the convenience, so it must not block starting an application.
    let accountPrefill: { values: Record<string, unknown>; providedKeys: string[] } | undefined;
    try {
      const profile = await getOrCreateUserProfile({ id: user.id, email: user.email || undefined });
      accountPrefill = buildAccountPrefill(profile);
    } catch (error) {
      console.warn('[registration] could not prefill from the account:', error);
    }

    const draft = await startRegistrationDraft({
      contestSlug: body.contestSlug,
      userId: user.id,
      role: storeRole,
      accountData: body.accountData,
      accountPrefill,
    });

    return successResponse({ success: true, draft }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create registration draft');
  }
}
