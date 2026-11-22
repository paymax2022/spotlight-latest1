/**
 * CONTEST-LOCK — an approved application is binding.
 *
 * The status screen already hides the edit affordance once an admin approves a
 * song for voting, so nobody *sees* a way to change the form. Nothing enforced
 * it: `saveRegistrationStep` never looked at `draft.status`, and
 * `submitRegistrationApplication` only early-returned for
 * `submitted | awaiting_payment | under_review` — so `approved` fell straight
 * through to a fresh write. Any authenticated contestant could therefore PATCH
 * `/api/registration/applications/<id>` (or POST `.../submit`) against an
 * approved entry and rewrite the answers the judges reviewed, or drag the row
 * back to `submitted` and out of the roster it had been promoted into.
 *
 * The rule: approval makes the submission binding. Locked set =
 * `approved | selected_for_public_voting | selected_for_bootcamp` — exactly the
 * statuses the voting projection already treats as "accepted onto a roster" and
 * the same set the promotion RPC fires on, so the lock cannot disagree with the
 * vote gate. `draft` and `more_information_requested` stay writable (the latter
 * is the admin *asking* the contestant to change something), and rejection,
 * withdrawal and disqualification are deliberately untouched here — a contestant
 * must still be able to act on those.
 *
 * SHAPE NOTE: the store is imported ONCE at module scope and the status under
 * test is read through `currentStatus` at query time. The sibling
 * `paid-submit-gate.spec.ts` instead re-imports the store per test behind
 * `vi.resetModules()`, which re-transforms that whole module graph every time —
 * measured 4.8 s for a single test against vitest's 5 s default, so it passes
 * alone and times out under a full-suite run. Same assertions here, one import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const APP_ID = '8977dc4a-630c-4658-9967-120dfbad1e44';
const LOCKED = ['approved', 'selected_for_public_voting', 'selected_for_bootcamp'];
const OPEN = ['draft', 'more_information_requested'];

/** The row the stubbed `registrations` table returns for the running test. */
let currentStatus = 'draft';
const captured: { inserts: any[]; updates: any[] } = { inserts: [], updates: [] };

function draftRow() {
  return {
    id: APP_ID,
    reference: 'OPENMI-000001-XXXX',
    contest_slug: 'open-mic-competition',
    status: currentStatus,
    role: 'public_user',
    user_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    submitted_at: '2026-01-02T00:00:00Z',
    completion_percent: 100,
    current_step: 'review_submit',
    fraud_flags: [],
    form_data: {
      'media.rightsConfirmed': true,
      'publicProfile.publicVotingConsent': true,
      'personal.firstName': 'Ada',
    },
  };
}

function chainFor(table: string, row: () => any, maybeRow: any): any {
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
  // Resolved per call, so a test that changes `currentStatus` sees it here.
  chain.single = () => {
    const data = row();
    return Promise.resolve({ data, error: data ? null : { code: 'PGRST116', message: 'nf' } });
  };
  chain.maybeSingle = () => Promise.resolve({ data: maybeRow, error: null });
  chain.then = (resolve: any) => resolve({ data: null, error: null });
  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) =>
      table === 'registrations' ? chainFor(table, draftRow, null) : chainFor(table, () => null, null),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackPayment: vi.fn().mockResolvedValue({ success: false, amountKobo: 0 }),
}));

// Real contest catalog (resolveAnyContest needs it for the fee lookup), one
// always-valid step, so a rejected write can only come from the lock itself.
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
        ],
      },
    ],
  };
});

vi.mock('@/src/server/registration/photo-pipeline', () => ({
  processContestantPhotoNoTemplate: vi
    .fn()
    .mockResolvedValue({ status: 'ready', photoUrl: 'https://cdn.test/cutout.png' }),
}));

vi.mock('@/src/server/registration/template-resolver', () => ({
  resolveActiveTemplateForContest: vi.fn().mockResolvedValue(null),
}));

const store = await import('@/src/server/registration/supabase-store');

beforeEach(() => {
  currentStatus = 'draft';
  captured.inserts.length = 0;
  captured.updates.length = 0;
});

function saveParams() {
  return {
    applicationId: APP_ID,
    stepKey: 'category_specific' as any,
    values: { 'personal.firstName': 'Rewritten After Approval' },
  };
}

describe('CONTEST-LOCK: saveRegistrationStep refuses a binding application', () => {
  for (const status of LOCKED) {
    it(`rejects a step save on '${status}' with 409 application_locked`, async () => {
      currentStatus = status;
      await expect(store.saveRegistrationStep(saveParams())).rejects.toMatchObject({
        status: 409,
        code: 'application_locked',
      });
      // Not "rejected after writing" — nothing reaches the row at all.
      expect(captured.updates.filter((u) => u.table === 'registrations')).toHaveLength(0);
    });
  }

  for (const status of OPEN) {
    it(`still saves a step on '${status}'`, async () => {
      currentStatus = status;
      const result = await store.saveRegistrationStep(saveParams());
      expect(result.validation.isValid).toBe(true);
      const write = captured.updates.find((u) => u.table === 'registrations');
      expect(write).toBeTruthy();
      expect(write.vals.form_data['personal.firstName']).toBe('Rewritten After Approval');
    });
  }
});

describe('CONTEST-LOCK: submitRegistrationApplication refuses a binding application', () => {
  for (const status of LOCKED) {
    it(`rejects a re-submit on '${status}' instead of resetting it to submitted`, async () => {
      currentStatus = status;
      await expect(store.submitRegistrationApplication(APP_ID)).rejects.toMatchObject({
        status: 409,
        code: 'application_locked',
      });
      expect(captured.updates.filter((u) => u.table === 'registrations')).toHaveLength(0);
    });
  }

  it('still lets an applicant fix a more_information_requested application', async () => {
    currentStatus = 'more_information_requested';
    const result = await store.submitRegistrationApplication(APP_ID);
    expect(result.success).toBe(true);
    expect(captured.updates.some((u) => u.table === 'registrations')).toBe(true);
  });
});
