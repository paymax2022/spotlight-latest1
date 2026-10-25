import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getActiveAcademySettings } from '@/src/server/services/academy';
import { createAcademyFeeIntent } from '@/src/server/payments/academy-fee-intents';
import { createAdminClient } from '@/lib/supabase/server';
import {
  isPricingKey,
  parseAreaSelections,
  tuitionForFormat,
  tuitionForSelections,
  tuitionPlanShape,
  ACADEMY_PRICING_FALLBACK_KEY,
  type AreaPricingOptionRow,
} from '@/src/server/services/academy/pricing';
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
      area_selections?: unknown;
      areas_of_interest?: unknown;
      pricing_option_key?: string;
      payment_preference?: string;
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
    const applicationFeeNgn =
      settings.registration_type === 'paid' ? Number(settings.application_fee ?? 0) : 0;

    // One charge: application fee + first tuition instalment, quoted from the
    // same rows and plan shape the apply route verifies against.
    const supabase = createAdminClient();
    const selections = parseAreaSelections(body.area_selections);
    if (selections === 'invalid') {
      return errorResponse('Each selection needs a known area and a valid training format', 400);
    }
    const slugs = selections
      ? Object.keys(selections)
      : Array.isArray(body.areas_of_interest)
        ? (body.areas_of_interest as unknown[]).map((v) => String(v)).filter(Boolean)
        : [];
    const { data: areaRows } = slugs.length
      ? await supabase.from('academy_interest_areas').select('id, slug, fee_ngn, is_active').in('slug', slugs)
      : { data: [] as Array<{ id: string; slug: string; fee_ngn: number | null; is_active?: boolean }> };
    const areas = ((areaRows ?? []) as Array<{ id: string; slug: string; fee_ngn: number | null; is_active?: boolean }>)
      .filter((a) => a.is_active !== false);
    const { data: optionRows } = areas.length
      ? await supabase.from('academy_area_pricing_options').select('area_id, key, label, note, price_ngn, sort_order').in('area_id', areas.map((a) => a.id))
      : { data: [] };
    const options = (optionRows ?? []) as AreaPricingOptionRow[];
    const formatKey = isPricingKey(body.pricing_option_key) ? body.pricing_option_key : ACADEMY_PRICING_FALLBACK_KEY;
    const areaTuition = selections
      ? tuitionForSelections(areas, selections, options)
      : tuitionForFormat(areas, formatKey, options);

    const { data: batchRow } = batchId
      ? await supabase.from('academy_batches')
          .select('training_fee_ngn, installments_count, fee_frequency, one_off_discount_pct')
          .eq('id', batchId).maybeSingle()
      : { data: null };
    const batch = batchRow as {
      training_fee_ngn: number | null; installments_count: number | null;
      fee_frequency: string | null; one_off_discount_pct: number | null;
    } | null;
    const shape = tuitionPlanShape({
      tuition: areaTuition > 0 ? areaTuition : Number(batch?.training_fee_ngn ?? 0),
      preference: body.payment_preference === 'one_off' ? 'one_off' : 'installment',
      installmentsCount: batch?.installments_count ?? null,
      feeFrequency: batch?.fee_frequency ?? null,
      oneOffDiscountPct: batch?.one_off_discount_pct ?? null,
    });

    const totalNgn = applicationFeeNgn + shape.firstDueNgn;
    if (totalNgn <= 0) {
      return errorResponse('Nothing is payable for the current intake', 400);
    }

    const reference = `academy-fee-${randomUUID()}`;
    const amountKobo = Math.round(totalNgn * 100);

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
      metadata: {
        purpose: 'academy_application_and_tuition',
        batchId,
        applicationFeeNgn,
        firstTuitionNgn: shape.firstDueNgn,
      },
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
