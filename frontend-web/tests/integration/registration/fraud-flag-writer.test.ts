/**
 * WHY THIS EXISTS — the persisted half of the `missing_id_number` fix.
 *
 * The unit spec (tests/unit/registration/fraud-flag-precision.spec.ts) proves the
 * function. This proves the column: that a real step save through the real store,
 * against a migrated Postgres, writes a `fraud_flags` array that no longer books
 * `missing_id_number` for an applicant whose contest form never rendered the input.
 * The admin console reads exactly this column, so a green unit test with a stale
 * writer would not change what an admin sees.
 *
 * Two rows, one per direction, because a fix that only ever removes flags is
 * indistinguishable from a check that stopped running:
 *   - `open-mic-competition` declares no ID field  -> no missing_id_number;
 *   - `reality-tv-show` declares one (optional)    -> missing_id_number stays.
 * Both rows omit phone and email, and both must still carry those two flags: no
 * wizard renders them (they come from the account), so form-awareness must NOT
 * reach them. That asymmetry is the design, and it is pinned here on the real
 * write path.
 *
 * Runs locally only, and skips without a stack:
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { saveRegistrationStep, getRegistrationDraft } from '@/src/server/registration/supabase-store';
import { buildRegistrationSteps } from '@/src/features/registration/config';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

// registrations.reference has CHECK ~ '^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$'.
const stamp = Date.now();
const REFERENCE = (tag: string) => `FRDSPEC-${stamp}-${tag}`;

let openMicId = '';
let realityTvId = '';
let openMicFlags: string[] = [];
let realityTvFlags: string[] = [];

async function seedDraft(contestSlug: string, reference: string) {
  const { data, error } = await db()
    .from('registrations')
    .insert({
      contest_slug: contestSlug,
      reference,
      status: 'draft',
      current_step: 'personal_information',
      completion_percent: 10,
      // Deliberately empty: the whole point is what the next save books.
      fraud_flags: [],
      form_data: {
        'personal.firstName': 'Fraud',
        'personal.lastName': 'Spec',
        'personal.dateOfBirth': '1995-04-04',
        // identity.idNumber, personal.primaryPhone and the account email are all
        // absent on purpose.
      },
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id as string;
}

/**
 * Save the step every built form ends with — declarations only, no ID input — and
 * read back what the writer actually stored. A rejected step would leave
 * `fraud_flags` untouched, which is why the validation result is asserted too:
 * without it, an invalid step would make these tests pass for the wrong reason.
 *
 * The step's own required fields are filled from the built form rather than
 * hard-coded, because the per-contest forms disagree about which declarations they
 * ask for and this spec must keep proving the write path when they change.
 */
async function saveFinalStep(applicationId: string) {
  const draft = await getRegistrationDraft(applicationId);
  expect(draft, 'seeded draft must read back').toBeTruthy();
  const step = buildRegistrationSteps(draft!).find((item) => item.key === 'review_submit');
  expect(step, 'built form lost its review_submit step').toBeDefined();

  const SAMPLE: Record<string, unknown> = {
    checkbox: true,
    tel: '+2349000000000',
    email: 'fraud-spec@example.test',
    date: '1995-04-04',
    number: 1,
    multi_select: [],
  };
  const values: Record<string, unknown> = {};
  for (const field of step!.fields) {
    if (!field.required) continue;
    if (field.type in SAMPLE) {
      values[field.key] = SAMPLE[field.type];
    } else if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
      values[field.key] = field.options[0];
    } else {
      values[field.key] = 'spec';
    }
  }

  const result = await saveRegistrationStep({ applicationId, stepKey: 'review_submit', values });
  expect(result.validation.isValid, JSON.stringify(result.validation.errors)).toBe(true);

  const { data, error } = await db()
    .from('registrations')
    .select('fraud_flags')
    .eq('id', applicationId)
    .single();
  expect(error, error?.message).toBeNull();
  return (data!.fraud_flags ?? []) as string[];
}

describe.skipIf(!live)('fraud flags written by a real step save (live)', () => {
  beforeAll(async () => {
    openMicId = await seedDraft('open-mic-competition', REFERENCE('OPEN'));
    realityTvId = await seedDraft('reality-tv-show', REFERENCE('TV'));
    openMicFlags = await saveFinalStep(openMicId);
    realityTvFlags = await saveFinalStep(realityTvId);
  });

  afterAll(async () => {
    for (const id of [openMicId, realityTvId]) {
      await db().from('registration_status_events').delete().eq('registration_id', id);
      await db().from('contestants').delete().eq('registration_id', id);
      await db().from('registrations').delete().eq('id', id);
    }
    const { data } = await db()
      .from('registrations')
      .select('id')
      .like('reference', 'FRDSPEC-%');
    expect(data ?? [], 'fixtures must not leak').toHaveLength(0);
  });

  it('does not book missing_id_number for a form that never asks for one', () => {
    expect(openMicFlags).not.toContain('missing_id_number');
  });

  it('still books it for the forms that DO collect an ID number', () => {
    expect(realityTvFlags).toContain('missing_id_number');
  });

  it('leaves missing_email and missing_phone unconditional through the real writer', () => {
    // Neither key is rendered by any built form, so if form-awareness had leaked
    // into them, both rows would come back clean on contactability.
    for (const flags of [openMicFlags, realityTvFlags]) {
      expect(flags).toContain('missing_email');
      expect(flags).toContain('missing_phone');
    }
  });
});
