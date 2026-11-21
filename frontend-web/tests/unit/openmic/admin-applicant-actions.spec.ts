import { describe, it, expect, vi } from 'vitest';

/**
 * Open Mic admin applicant actions — the write half of the Applications tab.
 *
 * These are the actions the console could not offer before: approve, shortlist,
 * waitlist, reject, disqualify, request more information and withdraw, plus a
 * contact edit. Every one of them lands on the `registrations` plane through the
 * same store function /admin/registration already uses, so the two consoles can
 * never disagree about what an applicant's status is.
 *
 * Pure tests: nothing here may construct a Supabase client or send a real email.
 * The store reads/writes and the mailer all arrive through
 * `OpenMicApplicantActionSources`, exactly as the read adapter does.
 */
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('action tests must not open a Supabase client');
  },
}));

import {
  applyOpenMicApplicantStatus,
  editOpenMicApplicantContact,
  informationRequestEmail,
  isAllowedOpenMicAction,
  openMicStatusForAction,
  OPEN_MIC_APPLICANT_ACTIONS,
  type OpenMicApplicantActionSources,
} from '@/src/server/registration-v2/open-mic-applicant-actions';
import type { RegistrationDraft } from '@/src/features/registration/types';

const CONTEST_ID = 'c7ab8479-0275-473d-a78f-b923664a3b54';
const APPLICATION_ID = 'bd462c15-21f9-4cf1-9a5e-da9bb7996a98';

function draft(over: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    id: APPLICATION_ID,
    reference: 'OPENMI-790408-61P2QJ',
    contestSlug: 'open-mic-dev',
    status: 'submitted',
    role: 'public_user',
    userId: 'ed2c401b-44b4-4074-9a1a-756b3e256225',
    createdAt: '2026-11-19T11:13:10.409Z',
    updatedAt: '2026-11-19T11:14:18.010Z',
    submittedAt: '2026-11-19T11:14:18.010Z',
    completionPercent: 100,
    currentStep: 'review_submit',
    fraudFlags: [],
    formData: {
      'personal.firstName': 'Mock',
      'personal.lastName': 'Testuser',
      'personal.stageName': 'Mock T',
      'personal.email': 'mock@example.com',
      'account.email': 'mock@example.com',
      'personal.primaryPhone': '+2349091231234',
    },
    ...over,
  };
}

type Fakes = OpenMicApplicantActionSources & {
  review: ReturnType<typeof vi.fn>;
  writeContact: ReturnType<typeof vi.fn>;
  mail: ReturnType<typeof vi.fn>;
};

function fakes(over: Partial<OpenMicApplicantActionSources> = {}): Fakes {
  const review = vi.fn(async () => draft({ status: 'approved' }));
  const writeContact = vi.fn(async () => undefined);
  const mail = vi.fn(async () => true);
  return {
    review,
    writeContact,
    mail,
    findContest: vi.fn(async () => ({ slug: 'open-mic-dev', title: 'Spotlight Open Mic (dev edition)' })),
    findApplication: vi.fn(async () => draft()),
    ...over,
  } as Fakes;
}

describe('openMicStatusForAction / isAllowedOpenMicAction', () => {
  it('maps every offered action onto a real registrations status', () => {
    expect(openMicStatusForAction('approve')).toBe('approved');
    expect(openMicStatusForAction('shortlist')).toBe('shortlisted');
    expect(openMicStatusForAction('waitlist')).toBe('waitlisted');
    expect(openMicStatusForAction('reject')).toBe('rejected');
    expect(openMicStatusForAction('disqualify')).toBe('disqualified');
    expect(openMicStatusForAction('request_information')).toBe('more_information_requested');
    expect(openMicStatusForAction('withdraw')).toBe('withdrawn');
  });

  it('exposes exactly the actions it maps, and no others', () => {
    for (const action of OPEN_MIC_APPLICANT_ACTIONS) {
      expect(isAllowedOpenMicAction(action)).toBe(true);
    }
    expect(OPEN_MIC_APPLICANT_ACTIONS).toHaveLength(7);
  });

  /**
   * 'winner', 'eliminated' and 'draft' are real ApplicationStatus values but are
   * not admin actions on this tab: the winner comes from voting, 'draft' belongs
   * to the applicant, and 'eliminated' would double up with reject/disqualify
   * without the audit trail to tell them apart.
   */
  it('refuses statuses that are not admin decisions', () => {
    expect(isAllowedOpenMicAction('winner')).toBe(false);
    expect(isAllowedOpenMicAction('eliminated')).toBe(false);
    expect(isAllowedOpenMicAction('draft')).toBe(false);
    expect(isAllowedOpenMicAction('')).toBe(false);
    expect(isAllowedOpenMicAction('submitted')).toBe(false);
  });
});

describe('applyOpenMicApplicantStatus', () => {
  it('writes the mapped status through the shared review store function', async () => {
    const s = fakes();
    const result = await applyOpenMicApplicantStatus(
      { contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'approve', note: 'Cleared for the showcase' },
      s,
    );

    expect(s.review).toHaveBeenCalledWith(APPLICATION_ID, { status: 'approved', note: 'Cleared for the showcase' });
    expect(result.status).toBe('approved');
  });

  /**
   * The Applications tab mixes two planes and every row carries an id. A
   * `competition_enrollments` id is not a `registrations` id, so without this
   * check the console would happily POST a legacy row's id and the store would
   * either 404 or, worse, hit an unrelated application.
   */
  it('refuses an application that does not belong to the contest', async () => {
    const s = fakes({ findApplication: vi.fn(async () => draft({ contestSlug: 'big-brother-naija' })) });
    await expect(
      applyOpenMicApplicantStatus({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'approve' }, s),
    ).rejects.toThrow(/contest/i);
    expect(s.review).not.toHaveBeenCalled();
  });

  it('refuses a contest id that matches nothing instead of guessing', async () => {
    const s = fakes({ findContest: vi.fn(async () => null) });
    await expect(
      applyOpenMicApplicantStatus({ contestId: '00000000-0000-0000-0000-000000000000', applicationId: APPLICATION_ID, action: 'approve' }, s),
    ).rejects.toThrow(/contest/i);
    expect(s.review).not.toHaveBeenCalled();
  });

  it('refuses an unknown action before touching the store', async () => {
    const s = fakes();
    await expect(
      applyOpenMicApplicantStatus(
        { contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'winner' as never },
        s,
      ),
    ).rejects.toThrow(/action/i);
    expect(s.review).not.toHaveBeenCalled();
  });

  /**
   * Requesting information is a message to a human being. A blank request would
   * leave the applicant staring at 'more information requested' with no idea
   * what is missing, so the note is mandatory for this action only.
   */
  it('requires a note when requesting more information', async () => {
    const s = fakes();
    await expect(
      applyOpenMicApplicantStatus(
        { contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'request_information' },
        s,
      ),
    ).rejects.toThrow(/note|information/i);
    expect(s.review).not.toHaveBeenCalled();
    expect(s.mail).not.toHaveBeenCalled();
  });

  it('emails the applicant when more information is requested', async () => {
    const s = fakes();
    await applyOpenMicApplicantStatus(
      {
        contestId: CONTEST_ID,
        applicationId: APPLICATION_ID,
        action: 'request_information',
        note: 'Please upload a clearer profile photo.',
      },
      s,
    );

    expect(s.review).toHaveBeenCalledWith(APPLICATION_ID, {
      status: 'more_information_requested',
      note: 'Please upload a clearer profile photo.',
    });
    expect(s.mail).toHaveBeenCalledTimes(1);
    const [to, subject, html] = s.mail.mock.calls[0] as unknown as [string, string, string];
    expect(to).toBe('mock@example.com');
    expect(subject).toMatch(/information/i);
    expect(html).toContain('Please upload a clearer profile photo.');
    expect(html).toMatch(/Spotlight Open Mic/);
  });

  it('does not email for a plain status change', async () => {
    const s = fakes();
    await applyOpenMicApplicantStatus({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'reject' }, s);
    expect(s.mail).not.toHaveBeenCalled();
  });

  /**
   * The status change is the record of decision; the email is courtesy. A mail
   * provider being down must never roll back or 500 an approval the admin
   * already made, so a failed send is logged and swallowed.
   */
  it('keeps the status change when the email send fails', async () => {
    const s = fakes({ mail: vi.fn(async () => { throw new Error('resend failed: 429'); }) });
    const result = await applyOpenMicApplicantStatus(
      {
        contestId: CONTEST_ID,
        applicationId: APPLICATION_ID,
        action: 'request_information',
        note: 'Need your stage photo.',
      },
      s,
    );
    expect(result.status).toBe('more_information_requested');
    expect(result.emailDelivered).toBe(false);
  });

  it('reports delivery when the email goes out', async () => {
    const s = fakes();
    const result = await applyOpenMicApplicantStatus(
      { contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'request_information', note: 'Need your stage photo.' },
      s,
    );
    expect(result.emailDelivered).toBe(true);
  });

  /**
   * Every dev machine and CI box has no RESEND_API_KEY, so sendEmail logs the
   * message and resolves false without throwing. Nothing was delivered, and a
   * console that said "emailed" there would teach admins not to trust it.
   */
  it('reports no delivery when the mailer has no provider configured', async () => {
    const s = fakes({ mail: vi.fn(async () => false) });
    const result = await applyOpenMicApplicantStatus(
      { contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'request_information', note: 'Need your stage photo.' },
      s,
    );
    expect(s.mail).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('more_information_requested');
    expect(result.emailDelivered).toBe(false);
  });

  /**
   * An applicant who applied while signed out has no email on the record. The
   * status still changes — the console is the notification — but the service
   * must not call the mailer with an empty address.
   */
  it('changes status without emailing when the applicant has no email on file', async () => {
    const s = fakes({ findApplication: vi.fn(async () => draft({ formData: { 'personal.firstName': 'No' } })) });
    const result = await applyOpenMicApplicantStatus(
      { contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'request_information', note: 'Need contact details.' },
      s,
    );
    expect(s.mail).not.toHaveBeenCalled();
    expect(result.emailDelivered).toBe(false);
  });

  /**
   * A registration row whose contest is not Open Mic must not be reachable from
   * this console either — the tab only ever lists Open Mic applicants, so a
   * hand-made request against another contest's application is refused.
   */
  it('refuses a withdrawn applicant that the store could not write', async () => {
    const s = fakes({ review: vi.fn(async () => null) });
    await expect(
      applyOpenMicApplicantStatus({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'withdraw' }, s),
    ).rejects.toThrow(/applicant|application|found/i);
  });

  it('withdraws through the same review path so the roster is deactivated', async () => {
    const s = fakes();
    await applyOpenMicApplicantStatus({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, action: 'withdraw' }, s);
    expect(s.review).toHaveBeenCalledWith(APPLICATION_ID, { status: 'withdrawn', note: undefined });
  });
});

describe('informationRequestEmail', () => {
  /**
   * The note is admin-authored free text going straight into an HTML email.
   * Escaping it is the difference between a message and an injected link.
   */
  it('escapes the note instead of interpolating raw HTML', () => {
    const { subject, html } = informationRequestEmail({
      stageName: 'Ada',
      contestTitle: 'Spotlight Open Mic',
      note: '<script>alert(1)</script>',
    });
    expect(subject).toMatch(/information/i);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Ada');
  });

  it('falls back to the legal name when there is no stage name', () => {
    const { html } = informationRequestEmail({ stageName: '', artistName: 'Mock Testuser', contestTitle: 'Open Mic', note: 'x' });
    expect(html).toContain('Mock Testuser');
  });
});

describe('editOpenMicApplicantContact', () => {
  it('writes the contact fields onto the personal step and keeps both email fields in sync', async () => {
    const s = fakes();
    await editOpenMicApplicantContact(
      {
        contestId: CONTEST_ID,
        applicationId: APPLICATION_ID,
        patch: { email: 'new@example.com', phone: '+2348012345678', stageName: 'Ada L' },
      },
      s,
    );

    const [, values] = s.writeContact.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(values['personal.email']).toBe('new@example.com');
    expect(values['account.email']).toBe('new@example.com');
    expect(values['personal.primaryPhone']).toBe('+2348012345678');
    expect(values['personal.stageName']).toBe('Ada L');
  });

  it('trims what it stores', async () => {
    const s = fakes();
    await editOpenMicApplicantContact(
      { contestId: CONTEST_ID, applicationId: APPLICATION_ID, patch: { email: '  new@example.com  ', phone: ' +2348012345678 ' } },
      s,
    );
    const [, values] = s.writeContact.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(values['personal.email']).toBe('new@example.com');
    expect(values['personal.primaryPhone']).toBe('+2348012345678');
  });

  it('refuses an email that is not an email', async () => {
    const s = fakes();
    await expect(
      editOpenMicApplicantContact({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, patch: { email: 'not-an-email' } }, s),
    ).rejects.toThrow(/email/i);
    expect(s.writeContact).not.toHaveBeenCalled();
  });

  it('refuses a phone that cannot be dialled', async () => {
    const s = fakes();
    await expect(
      editOpenMicApplicantContact({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, patch: { phone: 'abc' } }, s),
    ).rejects.toThrow(/phone/i);
    expect(s.writeContact).not.toHaveBeenCalled();
  });

  it('refuses an empty edit rather than writing nothing', async () => {
    const s = fakes();
    await expect(
      editOpenMicApplicantContact({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, patch: {} }, s),
    ).rejects.toThrow(/field|nothing|empty/i);
    expect(s.writeContact).not.toHaveBeenCalled();
  });

  /**
   * Same guard as the status action: the console is scoped to one contest, and a
   * PATCH must not be able to reach an applicant of a different one.
   */
  it('refuses to edit a contact belonging to another contest', async () => {
    const s = fakes({ findApplication: vi.fn(async () => draft({ contestSlug: 'big-brother-naija' })) });
    await expect(
      editOpenMicApplicantContact({ contestId: CONTEST_ID, applicationId: APPLICATION_ID, patch: { phone: '+2348012345678' } }, s),
    ).rejects.toThrow(/contest/i);
    expect(s.writeContact).not.toHaveBeenCalled();
  });
});
