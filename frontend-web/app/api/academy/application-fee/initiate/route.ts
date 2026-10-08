import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getActiveAcademySettings } from '@/src/server/services/academy';
import { createAcademyFeeIntent } from '@/src/server/payments/academy-fee-intents';
import { randomUUID } from 'node:crypto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Mints the Paystack reference for the Film Academy application fee and
 * records a pending intent row for it BEFORE the browser pays (AUD-FE-003
 * residual). The client then passes THIS reference to PaystackPop — a
 * client-minted reference would defeat the point: without the intent row a
 * paid charge whose form submit never arrives is invisible to the webhook
 * gateway handler, the recover endpoint, and the reconcile sweep.
 *
 * The amount is quoted HERE from academy_settings.application_fee — never
 * from the request — so a client cannot set its own fee.
 */
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => null)) as {
      email?: string;
      full_name?: string;
      batch_id?: string;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);

    // Session-derived email wins over the request body — the account is the
    // source of truth, same rule as POST /api/academy/apply.
    const email = String(user.email || body.email || '').trim();
    const fullName = String(body.full_name ?? '').trim();
    const batchId = String(body.batch_id ?? '').trim() || null;

    if (!email || !EMAIL_PATTERN.test(email)) {
      return errorResponse('A valid applicant email is required', 400);
    }
    if (!fullName) {
      return errorResponse('Applicant full name is required', 400);
    }

    const settings = await getActiveAcademySettings();
    const applicationFeeNgn = Number(settings.application_fee ?? 0);
    if (settings.registration_type !== 'paid' || applicationFeeNgn <= 0) {
      return errorResponse('No application fee is required for the current intake', 400);
    }

    const reference = `academy-fee-${randomUUID()}`;
    const amountKobo = Math.round(applicationFeeNgn * 100);

    // Persist BEFORE the client pays: this row is what the webhook/recover/
    // reconcile paths fulfil from, and what the apply route reconciles at
    // submit (AUD-FE-003 residual).
    await createAcademyFeeIntent({
      reference,
      userId: user.id,
      email,
      fullName,
      batchId,
      amountKobo,
      metadata: { purpose: 'academy_application_fee', batchId },
    });

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';

    return successResponse({
      reference,
      amountKobo,
      amountNgn: amountKobo / 100,
      email,
      publicKey,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to initiate application fee payment');
  }
}
