// What the hand-in page shows when the artist already answered.
//
// The bug this guards: an approved Open Mic applicant arriving from
// `/registration/<id>/status` at `/open-mic/<slug>/enter` was met with "Email
// Address*", "State*" and "LGA*" again — three required questions the account and
// their own application had already answered — and the form's own helper text told
// them Country, state and LGA were required. The rule lives in
// `src/features/openmic/handin-record.ts`; these tests pin the rendering decision
// that rule was written to drive, including the two cases that must keep asking:
// a location pair the LGA list cannot reproduce, and an artist with no application
// at all.
//
// Rendered as static markup, the pattern the sibling voting-card spec uses, so the
// component's Supabase client and effects never run.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
// Relative: vitest maps `@` to `src/`, and the live form is in the app-root `components/`.
import OpenMicEntryForm from '../../../components/openmic/OpenMicEntryForm';

const RENDER_PROPS = {
  contestSlug: 'spotlight-open-mic-2026-11',
  contestTitle: 'Spotlight Open Mic — November 2026 Edition',
  beatAvailable: true,
  beatRequiresPaidEntry: false,
};

function render(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(OpenMicEntryForm, { ...RENDER_PROPS, ...extra }));
}

describe('OpenMicEntryForm inherits what is already on record', () => {
  const html = render({
    inheritance: { email: '', state: 'Anambra', lga: 'Awka North', source: 'exact' },
    accountEmail: 'artist@example.com',
  });

  it('shows the location as an answer, not as two selects', () => {
    expect(html).toContain('Anambra · Awka North');
    expect(html).toContain('From your entry');
    expect(html).not.toContain('>State*<');
    expect(html).not.toContain('>LGA*<');
  });

  it('shows the sign-up email as an answer and names where it came from', () => {
    expect(html).toContain('artist@example.com');
    expect(html).toContain('From your account');
    expect(html).not.toContain('>Email Address*<');
  });

  it('still offers the way back to the question', () => {
    expect(html.match(/Change/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every unanswered question on the screen', () => {
    // This fixture answered no handles, so stage name, country, the handle fields
    // and the declarations all stay questions — inheritance only removes what the
    // entry actually holds.
    expect(html).toContain('Stage Name*');
    expect(html).toContain('Country*');
    expect(html).toContain('Completed Song MP3*');
  });
});

describe('OpenMicEntryForm keeps asking what it cannot confirm', () => {
  it('asks for state and LGA when the stored pair is not reproducible', () => {
    const html = render({
      inheritance: { email: 'artist@example.com', state: 'Lagos', lga: 'Yaba', source: 'open-mic' },
      accountEmail: 'artist@example.com',
    });
    expect(html).toContain('>State*<');
    expect(html).toContain('>LGA*<');
    expect(html).toContain('Select state');
    // LGA starts disabled: it only opens once a state is chosen, as before.
    expect(html).toMatch(/LGA\*<\/label>[\s\S]{0,400}?disabled=""/);
    // The email was still on record, so only the location question came back.
    expect(html).not.toContain('>Email Address*<');
  });

  it('asks everything for an artist with no application on record', () => {
    const html = render({ inheritance: undefined, accountEmail: '' });
    expect(html).toContain('>Email Address*<');
    expect(html).toContain('>State*<');
    expect(html).toContain('>LGA*<');
    expect(html).not.toContain('From your entry');
  });

  it('asks for an email when neither the application nor the account has one', () => {
    const html = render({
      inheritance: { email: '', state: 'Anambra', lga: 'Awka North', source: 'exact' },
      accountEmail: '',
    });
    expect(html).toContain('>Email Address*<');
    expect(html).toContain('Anambra · Awka North');
  });
});

// The handle pair is the last question this screen used to repeat. The endpoint
// needs a handle and the registration asked for one, so an entry that answered has
// to see an answer; an entry that answered NEITHER must still see the fields,
// because a hidden requirement the artist cannot satisfy is worse than a tap.
describe('OpenMicEntryForm inherits recorded social handles', () => {
  it('shows both handles as one confirmed answer', () => {
    const html = render({
      inheritance: {
        email: 'artist@example.com', state: 'Anambra', lga: 'Awka North',
        instagram: '@adaforce', tiktok: '@ada_tk', source: 'exact',
      },
      accountEmail: 'artist@example.com',
    });
    expect(html).toContain('@adaforce · @ada_tk');
    expect(html).toContain('Change it if either handle moved');
    expect(html).not.toContain('>Instagram<');
    expect(html).not.toContain('>TikTok<');
  });

  it('confirms the pair when the entry answered only one of them', () => {
    // One handle is all `POST /api/open-mic/submissions` asks for, and the row
    // shows exactly what is on record rather than padding a blank.
    const html = render({
      inheritance: { email: 'artist@example.com', instagram: '@adaforce', tiktok: '', source: 'exact' },
      accountEmail: 'artist@example.com',
    });
    expect(html).toContain('Social handles');
    expect(html).not.toContain('>Instagram<');
  });

  it('asks for a handle when the entry carries neither', () => {
    const html = render({
      inheritance: {
        email: 'artist@example.com', state: 'Anambra', lga: 'Awka North',
        instagram: '', tiktok: '   ', source: 'exact',
      },
      accountEmail: 'artist@example.com',
    });
    expect(html).toContain('>Instagram<');
    expect(html).toContain('>TikTok<');
    expect(html).not.toContain('Social handles');
    // The requirement is still stated where the artist can act on it.
    expect(html).toContain('At least one social media handle is required.');
  });

  it('asks for a handle for an artist with no application on record', () => {
    const html = render({ inheritance: undefined, accountEmail: '' });
    expect(html).toContain('>Instagram<');
    expect(html).toContain('>TikTok<');
  });
});
