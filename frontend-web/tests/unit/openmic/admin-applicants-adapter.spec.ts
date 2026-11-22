import { describe, it, expect, vi } from 'vitest';

/**
 * Open Mic admin applicants adapter — see
 * src/server/registration-v2/open-mic-applicants.ts for why the two planes
 * exist. These tests are pure: no Supabase client is ever constructed.
 */
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('adapter tests must not open a Supabase client');
  },
}));

import {
  mapRegistrationApplicant,
  mergeOpenMicApplicants,
  listOpenMicContestApplicants,
  type OpenMicApplicantRow,
  type OpenMicApplicantSources,
} from '@/src/server/registration-v2/open-mic-applicants';
import type { RegistrationDraft } from '@/src/features/registration/types';

const CONTEST_ID = 'c7ab8479-0275-473d-a78f-b923664a3b54';

function registrationDraft(over: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    id: 'bd462c15-21f9-4cf1-9a5e-da9bb7996a98',
    reference: 'OPENMI-790408-61P2QJ',
    contestSlug: 'open-mic-dev',
    status: 'approved',
    role: 'public_user',
    userId: 'ed2c401b-44b4-4074-9a1a-756b3e256225',
    createdAt: '2026-11-19T11:13:10.409Z',
    updatedAt: '2026-11-19T11:31:02.094Z',
    submittedAt: '2026-11-19T11:14:18.010Z',
    completionPercent: 100,
    currentStep: 'review_submit',
    fraudFlags: [],
    formData: {
      'personal.firstName': 'Mock',
      'personal.lastName': 'Testuser',
      'personal.email': 'spec.ng+doctor@gmail.com',
      'personal.primaryPhone': '+2349091231234',
      'payment.paymentStatus': 'waived',
      'contest.type': 'one_beat_one_verse',
    },
    ...over,
  };
}

function enrollmentRow(over: Partial<OpenMicApplicantRow> = {}): OpenMicApplicantRow {
  return {
    id: 'legacy-1',
    contestId: CONTEST_ID,
    artistName: 'Ada Legacy',
    stageName: 'Ada L',
    email: 'ada.legacy@example.com',
    phone: '+2348000000000',
    applicationStatus: 'approved',
    paymentStatus: 'paid',
    beatDownloadStatus: 'downloaded',
    appliedAt: '2026-11-01T09:00:00.000Z',
    source: 'enrollment',
    ...over,
  };
}

function sourcesWith(input: {
  contest?: { slug: string; contestType: string } | null;
  enrollments?: OpenMicApplicantRow[];
  drafts?: RegistrationDraft[];
  downloads?: string[];
}): OpenMicApplicantSources & { findContest: ReturnType<typeof vi.fn> } {
  const findContest = vi.fn(async () => input.contest ?? null);
  const listEnrollmentApplicants = vi.fn(async () => input.enrollments ?? []);
  const listRegistrationDrafts = vi.fn(async () => input.drafts ?? []);
  const listBeatDownloadUserIds = vi.fn(async () => input.downloads ?? []);
  return { findContest, listEnrollmentApplicants, listRegistrationDrafts, listBeatDownloadUserIds };
}

describe('mapRegistrationApplicant', () => {
  it('turns an approved open-mic registration into an Applications-tab row', () => {
    const row = mapRegistrationApplicant(registrationDraft(), CONTEST_ID);
    expect(row).toMatchObject({
      id: 'bd462c15-21f9-4cf1-9a5e-da9bb7996a98',
      artistName: 'Mock Testuser',
      email: 'spec.ng+doctor@gmail.com',
      phone: '+2349091231234',
      applicationStatus: 'approved',
      paymentStatus: 'waived',
      appliedAt: '2026-11-19T11:14:18.010Z',
      source: 'registration',
      registrationStatus: 'approved',
    });
  });

  /**
   * The console's applicationStatus deliberately collapses nineteen registration
   * states into three, which is right for the Reports tile and wrong for a tab
   * that now makes those decisions: an admin who clicks Shortlist and reloads
   * would see "Pending" and conclude the write was lost. The exact status rides
   * along beside the coarse one instead of replacing it.
   */
  it('carries the exact registration status the coarse column cannot show', () => {
    const asked = mapRegistrationApplicant(registrationDraft({ status: 'more_information_requested' }), CONTEST_ID);
    expect(asked.applicationStatus).toBe('pending');
    expect(asked.registrationStatus).toBe('more_information_requested');

    // The collapse reads a withdrawn applicant as a refused one, which is right
    // for counting and wrong for a reviewer who withdrew them by hand an hour
    // ago and wants the record to say so.
    const gone = mapRegistrationApplicant(registrationDraft({ status: 'withdrawn' }), CONTEST_ID);
    expect(gone.applicationStatus).toBe('rejected');
    expect(gone.registrationStatus).toBe('withdrawn');
  });

  it('leaves the exact status off a legacy enrollment row, which has no such column', async () => {
    const sources = sourcesWith({
      contest: { slug: 'open-mic-dev', contestType: 'one_beat_one_verse' },
      enrollments: [enrollmentRow()],
    });
    const rows = await listOpenMicContestApplicants(CONTEST_ID, sources);
    expect(rows[0].source).toBe('enrollment');
    expect(rows[0].registrationStatus).toBeUndefined();
  });

  it('reports a not-yet-reviewed registration as pending, not approved', () => {
    const row = mapRegistrationApplicant(registrationDraft({ status: 'submitted' }), CONTEST_ID);
    expect(row.applicationStatus).toBe('pending');
  });

  it('maps rejection and disqualification onto the Open Mic rejected status', () => {
    expect(mapRegistrationApplicant(registrationDraft({ status: 'rejected' }), CONTEST_ID).applicationStatus)
      .toBe('rejected');
    expect(mapRegistrationApplicant(registrationDraft({ status: 'disqualified' }), CONTEST_ID).applicationStatus)
      .toBe('rejected');
  });

  it('falls back to the account email and to createdAt when nothing was submitted', () => {
    const row = mapRegistrationApplicant(
      registrationDraft({ submittedAt: undefined, formData: { 'account.email': 'acct@example.com' } }),
      CONTEST_ID,
    );
    expect(row.email).toBe('acct@example.com');
    expect(row.appliedAt).toBe('2026-11-19T11:13:10.409Z');
  });

  it('says not_required when the registration carries no payment status', () => {
    const row = mapRegistrationApplicant(
      registrationDraft({ formData: { 'personal.firstName': 'No', 'personal.lastName': 'Fee' } }),
      CONTEST_ID,
    );
    expect(row.paymentStatus).toBe('not_required');
  });

  /**
   * The Beat Downloads column used to be a literal. The adapter's own comment said
   * registration-plane applicants "have no download record to report", which was
   * true of `beat_download_logs` only in the sense that the adapter never looked:
   * the log stores `user_id`, and `registrations` stores `user_id`, so the hand-off
   * is exactly as visible to this plane as to the other. On the dev database the
   * same three artists appear in both tables for contest c7ab8479 while the tab
   * said "not available" for every one of them.
   */
  it('reports a downloaded beat for the artist the download set contains', () => {
    const downloaded = new Set(['ed2c401b-44b4-4074-9a1a-756b3e256225']);
    expect(mapRegistrationApplicant(registrationDraft(), CONTEST_ID, downloaded).beatDownloadStatus)
      .toBe('downloaded');
  });

  it('keeps the status unrecorded for an artist the log holds no row for', () => {
    const downloaded = new Set(['6c6d04cd-5635-4b94-acd1-b5378b8a2975']);
    expect(mapRegistrationApplicant(registrationDraft(), CONTEST_ID, downloaded).beatDownloadStatus)
      .toBe('not_available');
    expect(mapRegistrationApplicant(registrationDraft(), CONTEST_ID).beatDownloadStatus)
      .toBe('not_available');
  });

  it('cannot claim a download for a draft with no user id', () => {
    const downloaded = new Set(['ed2c401b-44b4-4074-9a1a-756b3e256225']);
    expect(mapRegistrationApplicant(registrationDraft({ userId: undefined }), CONTEST_ID, downloaded)
      .beatDownloadStatus).toBe('not_available');
  });
});

describe('mergeOpenMicApplicants', () => {
  it('keeps both planes when they are different people and sorts newest first', () => {
    const merged = mergeOpenMicApplicants([enrollmentRow()], [mapRegistrationApplicant(registrationDraft(), CONTEST_ID)]);
    expect(merged).toHaveLength(2);
    expect(merged[0].email).toBe('spec.ng+doctor@gmail.com');
    expect(merged[1].email).toBe('ada.legacy@example.com');
  });

  it('collapses the same applicant to the registration row, case- and space-insensitively', () => {
    const merged = mergeOpenMicApplicants(
      [enrollmentRow({ email: ' SPEC.NG+Doctor@gmail.com ' })],
      [mapRegistrationApplicant(registrationDraft(), CONTEST_ID)],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('registration');
  });

  it('never drops a legacy row that has no email to match on', () => {
    const merged = mergeOpenMicApplicants(
      [enrollmentRow({ email: '' })],
      [mapRegistrationApplicant(registrationDraft(), CONTEST_ID)],
    );
    expect(merged).toHaveLength(2);
  });
});

describe('listOpenMicContestApplicants', () => {
  it('serves the registration-plane applicant for an Open Mic contest, resolved by the contest slug', async () => {
    const sources = sourcesWith({
      contest: { slug: 'open-mic-dev', contestType: 'one_beat_one_verse' },
      drafts: [registrationDraft()],
    });

    const rows = await listOpenMicContestApplicants(CONTEST_ID, sources);

    expect(sources.findContest).toHaveBeenCalledWith(CONTEST_ID);
    expect(sources.listRegistrationDrafts).toHaveBeenCalledWith('open-mic-dev');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ artistName: 'Mock Testuser', applicationStatus: 'approved', source: 'registration' });
  });

  /**
   * One read for the whole list, not one per applicant: the tab shows every
   * applicant of one contest, and `beat_download_logs` is already filtered by
   * competition. The download read runs alongside the merge, and an applicant whose
   * id is in it stops being reported as "not available".
   */
  it('marks the applicants the log recorded, from one scoped read', async () => {
    const sources = sourcesWith({
      contest: { slug: 'open-mic-dev', contestType: 'one_beat_one_verse' },
      drafts: [
        registrationDraft(),
        registrationDraft({
          id: '8977dc4a-630c-4658-9967-120dfbad1e44',
          userId: '6c6d04cd-5635-4b94-acd1-b5378b8a2975',
          formData: { 'personal.email': 'spec.ng+openmic@gmail.com' },
        }),
      ],
      downloads: ['6c6d04cd-5635-4b94-acd1-b5378b8a2975', 'ed2c401b-44b4-4074-9a1a-756b3e256225'],
    });

    const rows = await listOpenMicContestApplicants(CONTEST_ID, sources);

    expect(sources.listBeatDownloadUserIds).toHaveBeenCalledTimes(1);
    expect(sources.listBeatDownloadUserIds).toHaveBeenCalledWith(CONTEST_ID);
    expect(rows.find((r) => r.email === 'spec.ng+openmic@gmail.com')?.beatDownloadStatus).toBe('downloaded');
    expect(rows.find((r) => r.email === 'spec.ng+doctor@gmail.com')?.beatDownloadStatus).toBe('downloaded');
  });

  it('lists the applicants anyway when the download read fails', async () => {
    const sources = sourcesWith({
      contest: { slug: 'open-mic-dev', contestType: 'one_beat_one_verse' },
      drafts: [registrationDraft()],
    });
    sources.listBeatDownloadUserIds = vi.fn(async () => {
      throw new Error('beat_download_logs unreadable');
    });

    const rows = await listOpenMicContestApplicants(CONTEST_ID, sources);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ artistName: 'Mock Testuser', beatDownloadStatus: 'not_available' });
  });

  it('leaves enrollment rows on the status their own record carries', async () => {
    const sources = sourcesWith({
      contest: { slug: 'open-mic-dev', contestType: 'one_beat_one_verse' },
      enrollments: [enrollmentRow({ beatDownloadStatus: 'available' })],
      downloads: [],
    });

    const rows = await listOpenMicContestApplicants(CONTEST_ID, sources);

    expect(rows.find((r) => r.source === 'enrollment')?.beatDownloadStatus).toBe('available');
  });

  it('does not read the registration plane for a contest that is not an Open Mic edition', async () => {
    const sources = sourcesWith({
      contest: { slug: 'reality-tv-show', contestType: 'reality_tv' },
      enrollments: [enrollmentRow()],
      drafts: [registrationDraft()],
    });

    const rows = await listOpenMicContestApplicants(CONTEST_ID, sources);

    expect(sources.listRegistrationDrafts).not.toHaveBeenCalled();
    expect(rows.map((r) => r.source)).toEqual(['enrollment']);
  });

  it('keeps legacy enrollment rows visible and does not throw for an unknown contest id', async () => {
    const sources = sourcesWith({ contest: null, enrollments: [enrollmentRow()] });
    const rows = await listOpenMicContestApplicants('00000000-0000-4000-8000-000000000000', sources);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('enrollment');
  });

  it('surfaces a registration read failure instead of silently returning an empty tab', async () => {
    const sources = sourcesWith({ contest: { slug: 'open-mic-dev', contestType: 'one_beat_one_verse' } });
    sources.listRegistrationDrafts = vi.fn(async () => {
      throw new Error('registrations unreadable');
    });
    await expect(listOpenMicContestApplicants(CONTEST_ID, sources)).rejects.toThrow(/registrations unreadable/);
  });
});
