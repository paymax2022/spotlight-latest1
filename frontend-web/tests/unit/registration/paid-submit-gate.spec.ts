/**
 * AUD-BILL-002 — paid-contest submit must not trust a client-asserted
 * 'payment.paymentStatus': 'paid'.
 *
 * saveRegistrationStep merges PATCH step values wholesale, so the wizard (or
 * any direct PATCH caller) could set payment.paymentStatus='paid' plus an
 * arbitrary payment.transactionReference string and submitRegistrationApplication
 * transitioned the draft straight to 'submitted' — a paid contest could be
 * entered with zero money changing hands.
 *
 * The gate added to submitRegistrationApplication: a paid contest only goes
 * 'submitted' when payment is PROVEN — a completed/verified
 * registration_payment_intents row for the application, or the recorded
 * reference re-verifying with Paystack for at least the server-quoted fee.
 * Anything else lands at 'awaiting_payment' (retryable, no data loss).
 */
import { describe, it, expect, vi } from 'vitest';

const verifyMock = vi.fn();

function makeSupabaseStub(draftRow: any, intentRow: any, captured: { inserts: any[]; updates: any[] }) {
  const chainFor = (table: string, singleRow: any, maybeRow: any): any => {
    const chain: any = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.not = () => chain;
    chain.order = () => chain;
    chain.update = (vals: any) => {
      captured.updates.push({ table, vals });
      return chain;
    };
    chain.insert = (rows: any) => {
      for (const r of Array.isArray(rows) ? rows : [rows]) captured.inserts.push({ table, row: r });
      return chain;
    };
    chain.single = () => Promise.resolve({ data: singleRow, error: singleRow ? null : { code: 'PGRST116', message: 'nf' } });
    chain.maybeSingle = () => Promise.resolve({ data: maybeRow, error: null });
    chain.then = (resolve: any) => resolve({ data: null, error: null });
    return chain;
  };
  return {
    from: (table: string) =>
      table === 'registrations'
        ? chainFor(table, draftRow, null)
        : table === 'registration_payment_intents'
          ? chainFor(table, intentRow, intentRow)
          : chainFor(table, null, null),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function makeDraftRow(formData: Record<string, unknown>, contestSlug = 'open-mic-competition') {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    reference: 'OPENMI-000001-XXXX',
    contest_slug: contestSlug,
    status: 'draft',
    role: 'public_user',
    user_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    submitted_at: null,
    completion_percent: 0,
    current_step: 'review_submit',
    fraud_flags: [],
    form_data: {
      'media.rightsConfirmed': true,
      'publicProfile.publicVotingConsent': false,
      ...formData,
    },
  };
}

async function runSubmit(draftRow: any, intentRow: any) {
  vi.resetModules();
  const captured = { inserts: [] as any[], updates: [] as any[] };

  vi.doMock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => makeSupabaseStub(draftRow, intentRow, captured)),
  }));
  vi.doMock('@/src/server/voting/payment/paystack', () => ({ verifyPaystackPayment: verifyMock }));
  // Keep the real contest catalog (resolveAnyContest needs it for the fee/
  // isPaid lookup) but shrink the step list so validation stays minimal.
  vi.doMock('@/src/features/registration/config', async (importOriginal) => {
    const real = (await importOriginal()) as any;
    return {
      ...real,
      buildRegistrationSteps: () => [
        {
          key: 'category_specific',
          title: 'Contest Requirements',
          description: '',
          fields: [
            { key: 'media.rightsConfirmed', label: 'Rights', type: 'checkbox', required: true },
            { key: 'publicProfile.publicVotingConsent', label: 'Voting consent', type: 'checkbox', required: false },
          ],
        },
      ],
    };
  });
  vi.doMock('@/src/server/registration/photo-pipeline', () => ({
    processContestantPhotoNoTemplate: vi.fn().mockResolvedValue({ status: 'ready', photoUrl: 'https://cdn.test/cutout.png' }),
  }));
  vi.doMock('@/src/server/registration/template-resolver', () => ({
    resolveActiveTemplateForContest: vi.fn().mockResolvedValue(null),
  }));

  const { submitRegistrationApplication } = await import('@/src/server/registration/supabase-store');
  const result = await submitRegistrationApplication('33333333-3333-4333-8333-333333333333');
  const regUpdate = captured.updates.find((u) => u.table === 'registrations');
  vi.doUnmock('@/src/features/registration/config');
  return { result, captured, regUpdate };
}

describe('AUD-BILL-002: paid-contest submit requires proven payment', () => {
  it('rejects a bare client-asserted paid claim with a fabricated reference', async () => {
    verifyMock.mockReset().mockResolvedValue({ success: false, amountKobo: 0 });
    const { result, regUpdate } = await runSubmit(
      makeDraftRow({ 'payment.paymentStatus': 'paid', 'payment.transactionReference': 'SPOT-FAKE-123' }),
      null,
    );
    expect(result.success).toBe(true);
    expect(regUpdate.vals.status).toBe('awaiting_payment');
    expect(verifyMock).toHaveBeenCalledWith('SPOT-FAKE-123');
  });

  it('rejects a paid claim with no reference at all', async () => {
    verifyMock.mockReset();
    const { regUpdate } = await runSubmit(makeDraftRow({ 'payment.paymentStatus': 'paid' }), null);
    expect(regUpdate.vals.status).toBe('awaiting_payment');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('submits when a completed intent row exists for the application', async () => {
    verifyMock.mockReset();
    const { regUpdate } = await runSubmit(
      makeDraftRow({ 'payment.paymentStatus': 'paid' }),
      { id: 'intent-1', application_id: '33333333-3333-4333-8333-333333333333', amount_kobo: 200000, status: 'completed', reference: 'PAYSTACK-REF-1', idempotency_key: 'k', method: 'PAYSTACK', created_at: 'x', updated_at: 'x' },
    );
    expect(regUpdate.vals.status).toBe('submitted');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('submits when the PATCHed reference verifies with Paystack at the server fee, and backfills an intent', async () => {
    verifyMock.mockReset().mockResolvedValue({ success: true, amountKobo: 200000 });
    const { regUpdate, captured } = await runSubmit(
      makeDraftRow({ 'payment.paymentStatus': 'paid', 'payment.transactionReference': 'SPOT-REAL-9' }),
      null,
    );
    expect(regUpdate.vals.status).toBe('submitted');
    const intentInsert = captured.inserts.find((i) => i.table === 'registration_payment_intents');
    expect(intentInsert).toBeTruthy();
    expect(intentInsert.row.reference).toBe('SPOT-REAL-9');
  });

  it('rejects a reference that verifies but under-collected vs the server fee', async () => {
    verifyMock.mockReset().mockResolvedValue({ success: true, amountKobo: 100 });
    const { regUpdate } = await runSubmit(
      makeDraftRow({ 'payment.paymentStatus': 'paid', 'payment.transactionReference': 'SPOT-LOW-1' }),
      null,
    );
    expect(regUpdate.vals.status).toBe('awaiting_payment');
  });

  it('still awaits payment when the client asserts pending', async () => {
    verifyMock.mockReset();
    const { regUpdate } = await runSubmit(makeDraftRow({ 'payment.paymentStatus': 'pending' }), null);
    expect(regUpdate.vals.status).toBe('awaiting_payment');
  });

  it('does not honor a waived claim on a paid contest', async () => {
    verifyMock.mockReset();
    const { regUpdate } = await runSubmit(makeDraftRow({ 'payment.paymentStatus': 'waived' }), null);
    expect(regUpdate.vals.status).toBe('awaiting_payment');
  });

  it('leaves free contests unchanged — waived submits', async () => {
    verifyMock.mockReset();
    const { regUpdate } = await runSubmit(
      makeDraftRow({ 'payment.paymentStatus': 'waived' }, 'stem-contest'),
      null,
    );
    expect(regUpdate.vals.status).toBe('submitted');
  });
});
