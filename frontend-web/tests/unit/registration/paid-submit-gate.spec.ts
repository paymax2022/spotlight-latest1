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
 *
 * SHAPE NOTE: the store used to be re-imported per test behind
 * `vi.resetModules()`, which re-transforms its whole module graph every time.
 * Measured on a cold cache: the first test needed 4.8 s against vitest's 5 s
 * default. It passed alone and timed out under a directory run, and because the
 * abandoned `await import()` kept going after the abort, its Paystack call
 * landed inside the NEXT test — `expect(verifyMock).not.toHaveBeenCalled()`
 * then failed on a reference ('SPOT-FAKE-123') that test never passed. Same
 * eight assertions, one import: the status and intent rows the stub answers with
 * are read through the module-scope holders below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const APPLICATION_ID = '33333333-3333-4333-8333-333333333333';
const verifyMock = vi.fn();

/** What the stubbed tables answer for the running test. */
let currentDraftRow: any = null;
let currentIntentRow: any = null;
const captured: { inserts: any[]; updates: any[] } = { inserts: [], updates: [] };

function makeSupabaseStub() {
  const chainFor = (table: string, row: () => any, maybeRow: () => any): any => {
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
    // Read per call, so a test that changes the holders above is answered here.
    chain.single = () => {
      const data = row();
      return Promise.resolve({ data, error: data ? null : { code: 'PGRST116', message: 'nf' } });
    };
    chain.maybeSingle = () => {
      const data = maybeRow();
      return Promise.resolve({ data, error: null });
    };
    chain.then = (resolve: any) => resolve({ data: null, error: null });
    return chain;
  };
  return {
    from: (table: string) =>
      table === 'registrations'
        ? chainFor(table, () => currentDraftRow, () => null)
        : table === 'registration_payment_intents'
          ? chainFor(table, () => currentIntentRow, () => currentIntentRow)
          : chainFor(table, () => null, () => null),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function makeDraftRow(formData: Record<string, unknown>, contestSlug = 'open-mic-competition') {
  return {
    id: APPLICATION_ID,
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

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => makeSupabaseStub()),
}));
vi.mock('@/src/server/voting/payment/paystack', () => ({ verifyPaystackPayment: verifyMock }));
// Keep the real contest catalog (resolveAnyContest needs it for the fee/
// isPaid lookup) but shrink the step list so validation stays minimal.
vi.mock('@/src/features/registration/config', async (importOriginal) => {
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
vi.mock('@/src/server/registration/photo-pipeline', () => ({
  processContestantPhotoNoTemplate: vi.fn().mockResolvedValue({ status: 'ready', photoUrl: 'https://cdn.test/cutout.png' }),
}));
vi.mock('@/src/server/registration/template-resolver', () => ({
  resolveActiveTemplateForContest: vi.fn().mockResolvedValue(null),
}));

const { submitRegistrationApplication } = await import('@/src/server/registration/supabase-store');

beforeEach(() => {
  currentDraftRow = null;
  currentIntentRow = null;
  captured.inserts.length = 0;
  captured.updates.length = 0;
});

async function runSubmit(draftRow: any, intentRow: any) {
  currentDraftRow = draftRow;
  currentIntentRow = intentRow;
  const result = await submitRegistrationApplication(APPLICATION_ID);
  const regUpdate = captured.updates.find((u) => u.table === 'registrations');
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
      { id: 'intent-1', application_id: APPLICATION_ID, amount_kobo: 200000, status: 'completed', reference: 'PAYSTACK-REF-1', idempotency_key: 'k', method: 'PAYSTACK', created_at: 'x', updated_at: 'x' },
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
