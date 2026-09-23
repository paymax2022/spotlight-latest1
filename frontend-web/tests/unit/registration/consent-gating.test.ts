/**
 * UAT Batch 9 — SEC-010 / RG-003 / EC-006 / G-CON: photo/likeness public-use
 * consent gating.
 *
 * Covers:
 *  1. reviewRegistrationApplication's hard promotion-time consent gate
 *     (supabase-store.ts, immediately before the photo-moderation gate) —
 *     blocks (throws, no DB write attempted) when either consent flag is
 *     missing/false; succeeds when both are true (for a voting contest); a
 *     registration missing BOTH flags is still blocked, not just one.
 *  2. The non-regression case this gate deliberately carves out: a contest
 *     whose derived.supportsVoting is false (mirrors forms/film-academy.ts,
 *     which never renders publicProfile.publicVotingConsent at all) is NOT
 *     blocked on that field — only on the universal media.rightsConfirmed.
 *
 * Mocks @supabase/supabase-js directly, same pattern as
 * review-template-wiring.test.ts — supabase-store.ts builds its own lazy
 * client via createClient, not through @/lib/supabase/server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let registrationsRow: Record<string, unknown>;

function makeChain(table: string) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    insert: () => chain,
    single: () => Promise.resolve({ data: registrationsRow, error: null }),
    maybeSingle: () => Promise.resolve({ data: { id: 'connect-contest-1' }, error: null }),
  };
  if (table === 'registrations') {
    // .update({...}).eq('id', applicationId) is awaited directly with no
    // .select()/.single() in the notes-write step; .then lets `await` on the
    // chain itself resolve, same as review-template-wiring.test.ts's mock.
    chain.then = (resolve: any) => resolve({ data: null, error: null });
  }
  return chain;
}

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
const fromMock = vi.fn((table: string) => makeChain(table));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => fromMock(table),
    rpc: rpcMock,
  })),
}));

vi.mock('@/src/server/registration/photo-pipeline', () => ({
  processContestantPhoto: vi.fn(),
  processContestantPhotoNoTemplate: vi.fn().mockResolvedValue({ status: 'ready', photoUrl: 'https://cdn.test/cutout.png' }),
}));

vi.mock('@/src/server/registration/template-resolver', () => ({
  resolveActiveTemplateForContest: vi.fn().mockResolvedValue(null),
}));

import { reviewRegistrationApplication } from '@/src/server/registration/supabase-store';
import { processContestantPhotoNoTemplate } from '@/src/server/registration/photo-pipeline';

function baseRow(formData: Record<string, unknown>, contestSlug = 'reality-tv-show') {
  return {
    id: 'app-1',
    reference: 'REALTV-000001-ABCD',
    // reality-tv-show is one of only two hand-tailored live forms that
    // literally collect BOTH media.rightsConfirmed and
    // publicProfile.publicVotingConsent (the other is film-academy, which
    // never collects the voting-consent field — see the film-academy-style
    // test below, which explicitly overrides this to 'film-academy').
    // reviewRegistrationApplication's gate checks field PRESENCE via a real
    // (unmocked) buildRegistrationSteps(current) call, so the slug here
    // actually matters to these tests, not just formData.
    contest_slug: contestSlug,
    status: 'under_review',
    role: 'public_user',
    user_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    submitted_at: '2026-01-01T00:00:00Z',
    completion_percent: 100,
    current_step: 'review',
    fraud_flags: [],
    form_data: formData,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: null, error: null });
  vi.mocked(processContestantPhotoNoTemplate).mockResolvedValue({ status: 'ready', photoUrl: 'https://cdn.test/cutout.png' });
});

describe('SEC-010/RG-003/EC-006: reviewRegistrationApplication promotion-time consent gate', () => {
  it('blocks approval (throws, no DB write) when media.rightsConfirmed is missing', async () => {
    registrationsRow = baseRow({
      'derived.supportsVoting': true,
      'publicProfile.publicVotingConsent': true,
      // media.rightsConfirmed absent
    });

    await expect(reviewRegistrationApplication('app-1', { status: 'approved' })).rejects.toThrow(
      /rights to the uploaded materials/i,
    );
    // No DB write attempted: the gate throws before the notes UPDATE, so
    // 'registrations' is only ever touched for the initial read, never
    // via an .update(...) call, and the status-transition RPC never fires.
    expect(fromMock.mock.calls.filter(([table]) => table === 'registrations')).toHaveLength(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('blocks approval when publicProfile.publicVotingConsent is false and the contest supports voting', async () => {
    registrationsRow = baseRow({
      'derived.supportsVoting': true,
      'media.rightsConfirmed': true,
      'publicProfile.publicVotingConsent': false,
    });

    await expect(reviewRegistrationApplication('app-1', { status: 'approved' })).rejects.toThrow(
      /public voting visibility/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('blocks approval when BOTH consent flags are missing, not just one', async () => {
    registrationsRow = baseRow({
      'derived.supportsVoting': true,
      // neither key present
    });

    await expect(reviewRegistrationApplication('app-1', { status: 'approved' })).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('succeeds when both consent flags are true for a voting-enabled contest', async () => {
    registrationsRow = baseRow({
      'derived.supportsVoting': true,
      'media.rightsConfirmed': true,
      'publicProfile.publicVotingConsent': true,
      'media.photoUrl': 'https://cdn.test/raw-photo.jpg',
    });

    await expect(reviewRegistrationApplication('app-1', { status: 'approved' })).resolves.toBeDefined();
    expect(rpcMock).toHaveBeenCalled();
  });

  it('does not require publicProfile.publicVotingConsent for a contest with voting disabled (film-academy-style)', async () => {
    // Mirrors forms/film-academy.ts, whose header documents it "does NOT
    // support public voting" — that template never renders
    // publicProfile.publicVotingConsent, so form_data never carries it.
    // Requiring it unconditionally here would permanently block every
    // film-academy approval; gating on derived.supportsVoting avoids that
    // regression while still enforcing the universal rights confirmation.
    registrationsRow = baseRow(
      {
        'derived.supportsVoting': false,
        'media.rightsConfirmed': true,
        // publicProfile.publicVotingConsent intentionally absent — film-academy
        // never renders this field, so form_data can never carry it.
        'media.photoUrl': 'https://cdn.test/raw-photo.jpg',
      },
      'film-academy',
    );

    await expect(reviewRegistrationApplication('app-1', { status: 'selected_for_bootcamp' })).resolves.toBeDefined();
    expect(rpcMock).toHaveBeenCalled();
  });

  it('still blocks on media.rightsConfirmed for a contest that collects it, even when voting is disabled', async () => {
    registrationsRow = baseRow(
      {
        'derived.supportsVoting': false,
        // media.rightsConfirmed absent — film-academy DOES collect this key
        // (unlike publicProfile.publicVotingConsent), so it must still gate.
      },
      'film-academy',
    );

    await expect(reviewRegistrationApplication('app-1', { status: 'selected_for_bootcamp' })).rejects.toThrow(
      /rights to the uploaded materials/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('does not block promotion on either key for a contest form that never collects them under these names (e.g. open-mic-competition, which uses category.ownsRights instead)', async () => {
    registrationsRow = baseRow(
      {
        'derived.supportsVoting': true,
        // Neither media.rightsConfirmed nor publicProfile.publicVotingConsent
        // set — open-mic-competition's own rights-equivalent field is
        // category.ownsRights, out of this batch's scope (reuses only the two
        // named catalog fields). publicProfile.publicVotingConsent IS present
        // on open-mic's real form though, so set it true here to isolate what
        // this test is actually asserting: the media.rightsConfirmed skip.
        'publicProfile.publicVotingConsent': true,
        'media.photoUrl': 'https://cdn.test/raw-photo.jpg',
      },
      'open-mic-competition',
    );

    await expect(reviewRegistrationApplication('app-1', { status: 'approved' })).resolves.toBeDefined();
    expect(rpcMock).toHaveBeenCalled();
  });

  it('does not run the consent gate for a non-promoting status', async () => {
    registrationsRow = baseRow({}); // no consent flags at all
    await expect(reviewRegistrationApplication('app-1', { status: 'rejected' })).resolves.toBeDefined();
  });
});

describe('SEC-010: field-catalog now marks both consent fields required', () => {
  it('media.rightsConfirmed and publicProfile.publicVotingConsent are defaultRequired', async () => {
    const { getCatalogField, catalogFieldToRegistrationField } = await import('@/src/features/registration/field-catalog');

    const rights = getCatalogField('media.rightsConfirmed')!;
    const votingConsent = getCatalogField('publicProfile.publicVotingConsent')!;
    expect(rights.defaultRequired).toBe(true);
    expect(votingConsent.defaultRequired).toBe(true);

    // The property that actually reaches validateStepData is `required` on the
    // BUILT RegistrationField, not `defaultRequired` on the raw catalog entry —
    // catalogFieldToRegistrationField is the mapper that bridges them.
    expect(catalogFieldToRegistrationField(rights).required).toBe(true);
    expect(catalogFieldToRegistrationField(votingConsent).required).toBe(true);
  });

  it('film_production preset now includes publicProfile.publicVotingConsent (previously missing)', async () => {
    const { getCategoryFieldPreset } = await import('@/src/features/registration/field-catalog');
    const preset = getCategoryFieldPreset('film_production');
    expect(preset).toContain('publicProfile.publicVotingConsent');
    expect(preset).toContain('media.rightsConfirmed');
  });

  it('every category preset (including the general fallback) includes both consent keys', async () => {
    const { CATEGORY_FIELD_PRESETS, getCategoryFieldPreset } = await import('@/src/features/registration/field-catalog');
    const presetNames = [...Object.keys(CATEGORY_FIELD_PRESETS), 'unknown_category_falls_back_to_general'];
    for (const name of presetNames) {
      const preset = getCategoryFieldPreset(name);
      expect(preset, `${name} preset missing media.rightsConfirmed`).toContain('media.rightsConfirmed');
      expect(preset, `${name} preset missing publicProfile.publicVotingConsent`).toContain('publicProfile.publicVotingConsent');
    }
  });
});

describe('SEC-010: submission is genuinely blocked without consent (schema-driven contest path)', () => {
  it('validateStepData rejects an unchecked media.rightsConfirmed / publicProfile.publicVotingConsent', async () => {
    const { getCatalogField, catalogFieldToRegistrationField } = await import('@/src/features/registration/field-catalog');
    const { validateStepData } = await import('@/src/features/registration/validation');

    const step = {
      key: 'category_specific' as const,
      title: 'Contest Requirements',
      description: '',
      fields: [
        catalogFieldToRegistrationField(getCatalogField('media.rightsConfirmed')!),
        catalogFieldToRegistrationField(getCatalogField('publicProfile.publicVotingConsent')!),
      ],
    };

    const { isValid, errors } = validateStepData(step, {});
    expect(isValid).toBe(false);
    expect(errors['media.rightsConfirmed']).toBeTruthy();
    expect(errors['publicProfile.publicVotingConsent']).toBeTruthy();
  });

  it('validateStepData passes once both are checked', async () => {
    const { getCatalogField, catalogFieldToRegistrationField } = await import('@/src/features/registration/field-catalog');
    const { validateStepData } = await import('@/src/features/registration/validation');

    const step = {
      key: 'category_specific' as const,
      title: 'Contest Requirements',
      description: '',
      fields: [
        catalogFieldToRegistrationField(getCatalogField('media.rightsConfirmed')!),
        catalogFieldToRegistrationField(getCatalogField('publicProfile.publicVotingConsent')!),
      ],
    };

    const { isValid, errors } = validateStepData(step, {
      'media.rightsConfirmed': true,
      'publicProfile.publicVotingConsent': true,
    });
    expect(isValid).toBe(true);
    expect(errors).toEqual({});
  });

  it('media.rightsConfirmed is required where it exists (reality-tv-show, film-academy); the other 3 live forms use a category-appropriate equivalent instead, not this exact key', async () => {
    // Verified by actually running buildRegistrationSteps for all 5 slugs —
    // NOT assumed uniform. stem-contest/sme-pitch-contest/open-mic-competition
    // capture the same "I have rights to what I submitted" idea under a
    // different key (compliance.ownWork / category.ownsRights), which is why
    // reviewRegistrationApplication's promotion gate checks field PRESENCE
    // before enforcing media.rightsConfirmed, rather than assuming every
    // contest collects it under this exact name.
    const { buildRegistrationSteps } = await import('@/src/features/registration/config');

    const draftFor = (slug: string) => ({
      id: 'x', reference: 'R', contestSlug: slug, status: 'draft' as const, role: 'public_user' as const,
      createdAt: '', updatedAt: '', completionPercent: 0, fraudFlags: [],
      formData: { 'derived.age': 30, 'derived.legalAdultAge': 18 },
    });

    for (const slug of ['reality-tv-show', 'film-academy']) {
      const steps = buildRegistrationSteps(draftFor(slug));
      const field = steps.flatMap((s) => s.fields).find((f) => f.key === 'media.rightsConfirmed');
      expect(field, `${slug} has no media.rightsConfirmed field`).toBeDefined();
      expect(field!.required, `${slug}: media.rightsConfirmed should be required`).toBe(true);
    }

    const equivalentKeyBySlug: Record<string, string> = {
      'stem-contest': 'compliance.ownWork',
      'sme-pitch-contest': 'compliance.ownWork',
      'open-mic-competition': 'category.ownsRights',
    };
    for (const [slug, equivalentKey] of Object.entries(equivalentKeyBySlug)) {
      const steps = buildRegistrationSteps(draftFor(slug));
      const allFields = steps.flatMap((s) => s.fields);
      expect(allFields.find((f) => f.key === 'media.rightsConfirmed'), `${slug} unexpectedly gained media.rightsConfirmed`).toBeUndefined();
      const equivalent = allFields.find((f) => f.key === equivalentKey);
      expect(equivalent, `${slug} has no ${equivalentKey} field`).toBeDefined();
      expect(equivalent!.required, `${slug}: ${equivalentKey} should be required`).toBe(true);
    }
  });

  it('film-academy deliberately has no publicProfile.publicVotingConsent field (documented: does not support public voting)', async () => {
    const { buildRegistrationSteps } = await import('@/src/features/registration/config');
    const draft = {
      id: 'x', reference: 'R', contestSlug: 'film-academy', status: 'draft' as const, role: 'public_user' as const,
      createdAt: '', updatedAt: '', completionPercent: 0, fraudFlags: [],
      formData: { 'derived.age': 30, 'derived.legalAdultAge': 18 },
    };
    const steps = buildRegistrationSteps(draft);
    const field = steps.flatMap((s) => s.fields).find((f) => f.key === 'publicProfile.publicVotingConsent');
    expect(field).toBeUndefined();
  });

  it('the other 4 hand-tailored live contest forms already require publicProfile.publicVotingConsent at wizard time', async () => {
    const { buildRegistrationSteps } = await import('@/src/features/registration/config');
    const slugs = ['reality-tv-show', 'stem-contest', 'sme-pitch-contest', 'open-mic-competition'];
    for (const slug of slugs) {
      const draft = {
        id: 'x', reference: 'R', contestSlug: slug, status: 'draft' as const, role: 'public_user' as const,
        createdAt: '', updatedAt: '', completionPercent: 0, fraudFlags: [],
        formData: { 'derived.age': 30, 'derived.legalAdultAge': 18 },
      };
      const steps = buildRegistrationSteps(draft);
      const field = steps.flatMap((s) => s.fields).find((f) => f.key === 'publicProfile.publicVotingConsent');
      expect(field, `${slug} has no publicProfile.publicVotingConsent field`).toBeDefined();
      expect(field!.required, `${slug}: publicProfile.publicVotingConsent should be required`).toBe(true);
    }
  });
});

describe('SEC-010/RG-003/EC-006: submitRegistrationApplication records consent audit rows', () => {
  it('inserts one registration_consent_records row per consent key with the resolved accepted value', async () => {
    vi.resetModules();
    const insertedRows: any[] = [];

    const draftRow = {
      id: 'app-2',
      reference: 'OPENMI-000002-EFGH',
      contest_slug: 'open-mic-competition',
      status: 'draft',
      role: 'public_user',
      user_id: 'user-2',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      submitted_at: null,
      completion_percent: 0,
      current_step: 'review_submit',
      fraud_flags: [],
      form_data: {
        'derived.age': 30,
        'derived.legalAdultAge': 18,
        'media.rightsConfirmed': true,
        'publicProfile.publicVotingConsent': false, // recorded as-is, not assumed true
      },
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        from: (table: string) => {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            single: () => Promise.resolve({ data: draftRow, error: null }),
            insert: (rows: any) => {
              if (table === 'registration_consent_records') {
                insertedRows.push(...(Array.isArray(rows) ? rows : [rows]));
              }
              return Promise.resolve({ data: null, error: null });
            },
            update: () => chain,
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
          return chain;
        },
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }));

    // Stub the step builder so this test is decoupled from open-mic's full
    // required-field list (which would make it brittle against unrelated
    // future form edits) — validateStepData itself stays REAL, exercising the
    // actual code path submitRegistrationApplication calls; it is only fed a
    // minimal step containing exactly the two consent fields, both already
    // satisfied by draftRow.form_data above, so validation genuinely passes
    // and the insert this test asserts on genuinely fires.
    vi.doMock('@/src/features/registration/config', () => ({
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
    }));

    const { submitRegistrationApplication } = await import('@/src/server/registration/supabase-store');

    const result = await submitRegistrationApplication('app-2');
    expect(result.success).toBe(true);

    expect(insertedRows).toHaveLength(2);
    const keys = insertedRows.map((r) => r.consent_key).sort();
    expect(keys).toEqual(['media.rightsConfirmed', 'publicProfile.publicVotingConsent']);
    const rights = insertedRows.find((r) => r.consent_key === 'media.rightsConfirmed');
    const voting = insertedRows.find((r) => r.consent_key === 'publicProfile.publicVotingConsent');
    expect(rights.accepted).toBe(true);
    expect(voting.accepted).toBe(false); // reflects form_data as-is, not assumed true
    expect(rights.registration_id).toBe('app-2');
    expect(rights.ip_address).toBeNull();
    expect(rights.device_fingerprint).toBeNull();

    vi.doUnmock('@/src/features/registration/config');
  });
});
