/**
 * Webhook-context fulfilment for academy tuition instalments (AUD-FE-003
 * residual).
 *
 * The member confirm route (/api/academy/installments/pay) forwards to the Go
 * backend with the payer's JWT — a credential a Paystack webhook or the
 * gateway recover/reconcile sweep does not have. This module closes that gap:
 * given a Paystack-verified charge it resolves the pending instalment row from
 * the charge's metadata custom_fields (plan_id + installment_number — the
 * pending row stores no reference until it is paid), then calls the
 * service-token-gated internal confirm endpoint, which re-runs the SAME
 * hardened money path (provider re-verify, amount/currency check,
 * reference-reuse guard, balanced ledger journal, conditional UPDATE).
 *
 * Idempotent by construction: the derived idempotency key matches the member
 * route's, and a 409 idempotency_collision means another caller is in-flight
 * or done — treated as fulfilled.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { GO_BACKEND_URL } from '@/src/lib/go-backend';
import { sendTransactionalEmail } from '@/src/lib/email';
import { ensureEnrollment } from '@/src/server/services/academy';

type Supabase = ReturnType<typeof createAdminClient>;

interface AcademyInstallmentKeys {
  planId: string;
  installmentNumber: number;
}

/**
 * Reads the instalment coordinates out of a verified Paystack charge's
 * metadata. The dashboard client attaches them as custom_fields; nothing else
 * in the platform sets BOTH variable names, so their joint presence identifies
 * an academy tuition charge.
 */
export function academyInstallmentKeysFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): AcademyInstallmentKeys | null {
  const fields = (metadata as { custom_fields?: unknown } | null)?.custom_fields;
  if (!Array.isArray(fields)) return null;

  let planId: string | null = null;
  let installmentNumber: number | null = null;
  for (const field of fields) {
    const f = field as { variable_name?: unknown; value?: unknown };
    if (f?.variable_name === 'plan_id' && typeof f.value === 'string' && f.value) {
      planId = f.value;
    }
    if (f?.variable_name === 'installment_number') {
      const n = Number(f.value);
      if (Number.isInteger(n) && n >= 1) installmentNumber = n;
    }
  }
  return planId && installmentNumber !== null ? { planId, installmentNumber } : null;
}

/** True when the event metadata marks an academy tuition instalment charge. */
export function isAcademyInstallmentMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return academyInstallmentKeysFromMetadata(metadata) !== null;
}

interface PendingInstallmentRow {
  id: string;
  plan_id: string;
  installment_number: number;
  status: string;
}

/** The pending instalment a verified charge maps to, or null when none. */
async function findPendingInstallment(
  supabase: Supabase,
  keys: AcademyInstallmentKeys,
): Promise<PendingInstallmentRow | null> {
  const { data, error } = await supabase
    .from('academy_installment_payments')
    .select('id, plan_id, installment_number, status')
    .eq('plan_id', keys.planId)
    .eq('installment_number', keys.installmentNumber)
    .maybeSingle();
  if (error) throw error;
  const row = (data as PendingInstallmentRow | null) ?? null;
  return row && row.status === 'pending' ? row : null;
}

const INTERNAL_CONFIRM_TIMEOUT_MS = 20_000;

/**
 * Confirms one pending instalment through the Go internal endpoint.
 * Returns 'fulfilled', 'skipped' (nothing pending / already paid), or throws a
 * retryable error (network/5xx). Terminal rejections (4xx) are logged and
 * skipped — an underpayment or reused reference must not loop the webhook.
 */
export async function fulfilAcademyInstallment(
  reference: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<'fulfilled' | 'skipped'> {
  const keys = academyInstallmentKeysFromMetadata(metadata);
  if (!keys) return 'skipped';

  const supabase = createAdminClient();
  const pending = await findPendingInstallment(supabase, keys);
  if (!pending) return 'skipped';

  const serviceToken =
    process.env.GO_INTERNAL_SERVICE_TOKEN || process.env.LEDGER_SERVICE_TOKEN || '';
  if (!serviceToken) {
    // Mis-provisioned deployment — retryable so it surfaces instead of
    // silently dropping a paid charge. Wire LEDGER_SERVICE_TOKEN (the shared
    // internal service credential) into the frontend-web environment.
    throw new Error('academy tuition fulfilment: internal service token not configured');
  }

  const upstream = await fetch(
    `${GO_BACKEND_URL}/internal/finance/academy/tuition/confirm`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceToken}`,
      },
      // No Idempotency-Key — the endpoint derives the same
      // academy-tuition-confirm:{paymentId}:{reference} key the member route
      // uses, so a webhook/recover fulfil and a late client confirm collide.
      body: JSON.stringify({
        planId: pending.plan_id,
        paymentId: pending.id,
        reference,
      }),
      signal: AbortSignal.timeout(INTERNAL_CONFIRM_TIMEOUT_MS),
    },
  );

  if (upstream.status === 409) {
    // idempotency_collision: the member confirm is in-flight or done.
    return 'fulfilled';
  }
  if (upstream.status >= 400 && upstream.status < 500) {
    // Terminal: underpayment, wrong currency, reused reference, waived row.
    // The charge stays unfulfilled for an operator to review — acknowledge so
    // Paystack stops redelivering.
    const body = (await upstream.json().catch(() => null)) as { error?: string } | null;
    console.error(
      `[gateway-fulfil] academy instalment ${pending.id} terminally rejected: ${upstream.status} ${body?.error ?? ''}`,
    );
    return 'skipped';
  }
  if (!upstream.ok) {
    throw new Error(`academy tuition confirm failed: ${upstream.status}`);
  }

  const data = (await upstream.json().catch(() => ({}))) as {
    data?: { applicationId?: string };
  };
  await postInstallmentPaidEffects(supabase, pending.id, data.data?.applicationId, reference);
  return 'fulfilled';
}

/**
 * The post-confirmation side effects the member confirm route has always run:
 * enrolment (idempotent — UNIQUE(application_id)) plus the confirmation email.
 * Shared so webhook/recover fulfilment produces the same outcome as the
 * client-driven path. Best-effort: neither touches money, and a failure must
 * not fail the already-settled payment.
 */
export async function postInstallmentPaidEffects(
  supabase: Supabase,
  paymentId: string,
  applicationId: string | undefined,
  reference: string,
): Promise<void> {
  if (applicationId) {
    await ensureEnrollment(supabase, applicationId).catch((e) => {
      console.error('[academy/fulfil] enrolment failed after payment', e);
    });
  }

  const { data: payment } = await supabase
    .from('academy_installment_payments')
    .select('installment_number, amount_ngn, academy_installment_plans(academy_applications(full_name, email))')
    .eq('id', paymentId)
    .maybeSingle();

  const row = payment as {
    installment_number?: number;
    amount_ngn?: number;
    academy_installment_plans?: { academy_applications?: { full_name?: string; email?: string } };
  } | null;
  const app = row?.academy_installment_plans?.academy_applications;

  if (!app?.email) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
  const amount = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
  }).format(row?.amount_ngn ?? 0);
  await sendTransactionalEmail({
    to: app.email,
    subject: 'Spotlight Film Academy — Installment Payment Confirmed',
    text: `Hello ${app.full_name},\n\nYour installment payment of ${amount} (Ref: ${reference}) has been confirmed.\n\nView your dashboard: ${siteUrl}/film-academy/dashboard\n\nSpotlight Film Academy Team`,
    html: `<div style="font-family:Arial,sans-serif;color:#111827;"><h2>Installment Payment Confirmed</h2><p>Hello <strong>${app.full_name}</strong>,</p><p>Your installment #${row?.installment_number} payment of <strong>${amount}</strong> has been confirmed successfully.</p><p><strong>Reference:</strong> ${reference}</p><p><a href="${siteUrl}/film-academy/dashboard" style="background:#f59e0b;color:#000;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">View Dashboard</a></p></div>`,
  }).catch(() => {});
}
