// Two halves of the same promise: the admin console shows the submission window
// in the operator's own fields, and it shows a window verdict that agrees with
// the server's. The rule itself is strict by default — no dates means CLOSED —
// so a console that displayed only "Status: published" would hide the one
// setting that stops every hand-in.
//
// The frontend-admin copy is a MIRROR of frontend-web/src/server/openmic/submission-window.ts
// (separately deployed Next apps; each `@/*` resolves inside itself). The last
// case reads the web app's file and pins the shared strings, because a mirror
// nobody checks is a mirror that drifts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  describeSubmissionWindow,
  formatWindowStamp,
  isSubmissionWindowOpen,
  submissionWindowNotice,
  toDateTimeLocalInput,
} from '@/features/openmic/submission-window';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');

describe('describeSubmissionWindow', () => {
  it('treats an edition with no dates as closed, not open', () => {
    const verdict = describeSubmissionWindow({ status: 'published' }, NOW);
    expect(verdict).toMatchObject({ open: false, reason: 'no_window_configured' });
    expect(isSubmissionWindowOpen({ status: 'published' }, NOW)).toBe(false);
  });

  it('reports the same for a missing edition', () => {
    expect(describeSubmissionWindow(null, NOW).reason).toBe('no_window_configured');
  });

  it('honours the status that force-opens whatever the dates say', () => {
    const verdict = describeSubmissionWindow(
      { status: 'submission_open', submissionStartAt: '2020-01-01T00:00:00.000Z', submissionEndAt: '2020-01-02T00:00:00.000Z' },
      NOW,
    );
    expect(verdict).toMatchObject({ open: true, reason: 'open' });
  });

  it('names the three calendar states', () => {
    expect(describeSubmissionWindow({ status: 'published', submissionStartAt: '2026-12-01T00:00:00.000Z' }, NOW).reason).toBe('before_start');
    expect(describeSubmissionWindow({ status: 'published', submissionEndAt: '2026-11-01T00:00:00.000Z' }, NOW).reason).toBe('after_end');
    expect(
      describeSubmissionWindow({ status: 'under_review', submissionStartAt: '2026-11-01T00:00:00.000Z', submissionEndAt: '2026-11-30T00:00:00.000Z' }, NOW).reason,
    ).toBe('open');
  });

  it('carries both bounds so a screen can print them', () => {
    const verdict = describeSubmissionWindow(
      { status: 'published', submissionStartAt: '2026-11-01T00:00:00.000Z', submissionEndAt: '2026-11-30T00:00:00.000Z' },
      NOW,
    );
    expect(verdict.startsAt).toBe('2026-11-01T00:00:00.000Z');
    expect(verdict.endsAt).toBe('2026-11-30T00:00:00.000Z');
  });
});

describe('submissionWindowNotice', () => {
  it('says hand-ins are refused when no window is configured', () => {
    const notice = submissionWindowNotice({ status: 'voting_live' }, NOW);
    expect(notice.tone).toBe('warn');
    expect(notice.text).toMatch(/cannot hand in a song/i);
    // The fix has to be in the same sentence as the problem: either dates or status.
    expect(notice.text).toMatch(/submission_open/i);
  });

  it('confirms an open window and names the deadline', () => {
    const notice = submissionWindowNotice(
      { status: 'under_review', submissionStartAt: '2026-11-01T00:00:00.000Z', submissionEndAt: '2026-11-30T18:00:00.000Z' },
      NOW,
    );
    expect(notice.tone).toBe('ok');
    expect(notice.text).toMatch(/open until /);
  });

  it('keeps a closed window amber even while the status itself reads fine', () => {
    const notice = submissionWindowNotice({ status: 'published', submissionEndAt: '2026-11-01T00:00:00.000Z' }, NOW);
    expect(notice.tone).toBe('warn');
    expect(notice.text).toMatch(/closed on /i);
  });
});

describe('formatWindowStamp', () => {
  it('is deterministic, because a locale-formatted date cannot be asserted', () => {
    expect(formatWindowStamp('not a date')).toBe('not a date');
    expect(formatWindowStamp('2026-11-30T18:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('toDateTimeLocalInput', () => {
  it('leaves a stored local value alone', () => {
    // A datetime-local field saves exactly this shape. Re-parsing it as UTC and
    // re-printing it locally would shift an already-correct date by the offset.
    expect(toDateTimeLocalInput('2026-11-20T18:00')).toBe('2026-11-20T18:00');
    expect(toDateTimeLocalInput('2026-11-20T18:00:00')).toBe('2026-11-20T18:00');
  });

  it('turns a zone-aware value into the wall clock the field shows', () => {
    expect(toDateTimeLocalInput('2026-11-20T18:00:00.000Z')).toMatch(/^2026-11-2[01]T\d{2}:00$/);
  });

  it('answers empty for empty, so the field renders unset rather than 1970', () => {
    expect(toDateTimeLocalInput('')).toBe('');
    expect(toDateTimeLocalInput(null)).toBe('');
    expect(toDateTimeLocalInput(undefined)).toBe('');
    expect(toDateTimeLocalInput('nonsense')).toBe('nonsense');
  });
});

describe('the mirror stays a mirror', () => {
  it('shares its reason names and its force-open status with frontend-web', () => {
    const web = readFileSync(
      resolve(__dirname, '../../../../frontend-web/src/server/openmic/submission-window.ts'),
      'utf8',
    );
    // Every reason this module can return must be a word the server also uses,
    // and every branch must actually be reachable here, or the console is
    // describing a rule that no longer exists.
    expect(describeSubmissionWindow({ status: 'published' }, NOW).reason).toBe('no_window_configured');
    expect(describeSubmissionWindow({ status: 'published', submissionStartAt: '2030-01-01T00:00:00.000Z' }, NOW).reason).toBe('before_start');
    expect(describeSubmissionWindow({ status: 'published', submissionEndAt: '2020-01-01T00:00:00.000Z' }, NOW).reason).toBe('after_end');
    for (const reason of ['no_window_configured', 'before_start', 'after_end', 'submission_open']) {
      expect(web).toContain(reason);
    }
    // The two copies must agree that an unset window is closed, or the console
    // tells the operator the opposite of what the presign route will do.
    expect(isSubmissionWindowOpen({ status: 'submission_closed' }, NOW)).toBe(false);
  });
});
