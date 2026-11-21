// The Open Mic song hand-in, driven in a real browser.
//
// Reported from the phone-equivalent web build: the artist picked their MP3, typed
// the form, and the "Upload and submit" button stayed inert with nothing on screen
// saying why. These specs pin the two halves of that complaint:
//
//   1. what the artist already gave must not be asked for a second time (the
//      answers arrive in the fields, or collapse into a confirmed row);
//   2. the submit CTA must never be silent about what it is waiting for.
//
// Auth is seeded by the shared helper; the Open Mic verdict and the applicant's
// own registration are routed, because eligibility is the server's call and a
// spec must not depend on a developer's local rows. The payloads below are the
// real shapes: the answers are the ones on the dev edition's approved application
// (`registrations.form_data` for 8977dc4a).

import { expect, test, type Page } from '@playwright/test';
import { mockAuth, mockPinStatus, seedSession } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { users } from '../helpers/testData';

const SLUG = 'open-mic-dev';

const ELIGIBILITY = {
  success: true,
  eligibility: {
    contestId: 'c7ab8479-0275-473d-a78f-b923664a3b54',
    contestSlug: SLUG,
    status: 'submission_open',
    canSubmitSong: true,
    reason: 'ok',
    source: 'registration',
    beat: {
      id: 'beat-1',
      title: 'Spotlight Open Mic Official Beat',
      genre: 'Afrobeats',
      durationSeconds: 95,
      producerCredit: 'Prod. by Spotlight',
      usageRules: 'Record over the official beat only.',
      requiresPaidEntry: false,
      previewUrl: '/api/open-mic/beats/beat-1/preview',
      downloadUrl: '/api/open-mic/beats/beat-1/download',
    },
    window: {
      open: true,
      reason: 'open',
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.000Z',
    },
    submission: null,
  },
};

const APPLICATIONS = {
  success: true,
  applications: [
    {
      id: '8977dc4a-630c-4658-9967-120dfbad1e44',
      reference: 'OPNMIC-DEV-0001',
      contestSlug: SLUG,
      status: 'approved',
      role: 'public_user',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-21T10:39:44.000Z',
      completionPercent: 100,
      currentStep: 'review_submit',
      fraudFlags: [],
      formData: {
        'personal.firstName': 'hello',
        'personal.lastName': 'new',
        'personal.email': 'spec.ng+openmic@gmail.com',
        'personal.stateOfResidence': 'Anambra',
        'personal.city': 'Awka North',
        'contest.title': 'Spotlight Open Mic (dev edition)',
      },
    },
  ],
};

async function openHandin(page: Page) {
  // The ambient stubs are load-bearing here, not boilerplate: the axios
  // interceptor in src/api/client.ts signs the user out on ANY 401, and the
  // notification/election bridges fire while this screen is up. Without them the
  // card is replaced by /login a few seconds in and every assertion below is
  // about the harness.
  await mockAmbientRequests(page);
  await mockAuth(page, users.funded);
  await mockPinStatus(page, true);
  await seedSession(page, users.funded);
  let askedApplications = false;
  await page.route(`**/api/open-mic/me/eligibility**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ELIGIBILITY) }),
  );
  await page.route('**/api/registration/applications**', (route) => {
    askedApplications = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(APPLICATIONS),
    });
  });
  await page.goto(`/openmic?contestSlug=${SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Hand in the track you recorded over the official beat.')).toBeVisible({
    timeout: 30_000,
  });
  // Precondition, not an assertion about the card: if the bundle is running the
  // registration client in its mock mode it answers from localStorage and never
  // asks the network, and every failure below would then be about the harness
  // rather than about the form.
  await expect.poll(() => askedApplications, { timeout: 20_000 }).toBe(true);
}

const submitButton = (page: Page) => page.getByRole('button', { name: 'Upload and submit' });

/** The file input is created by expo-document-picker on tap, so answer the chooser. */
async function pickSong(page: Page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose the finished MP3' }).click(),
  ]);
  await chooser.setFiles({
    name: 'my-song.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3'.padEnd(2048, '\0'), 'latin1'),
  });
  await expect(page.getByText('my-song.mp3')).toBeVisible();
}

async function tickAllDeclarations(page: Page) {
  for (const label of [
    'I recorded this song over the official beat for this edition.',
    'I own or have the rights to the lyrics and the recording I am submitting.',
    'It has no unauthorised samples, and I can perform it live if shortlisted.',
  ]) {
    await page.getByText(label).click();
  }
}

async function chooseStateAndLga(page: Page, state: string, lga: string) {
  // `exact` because the LGA trigger's own placeholder is "Select your state
  // first" until a state exists, and it is on screen at the same time.
  await page.getByText('Select your state', { exact: true }).click();
  await page.getByText(state, { exact: true }).click();
  await page.getByText('Select your LGA', { exact: true }).click();
  await page.getByText(lga, { exact: true }).click();
}

test.describe('Open Mic song hand-in', () => {
  test('the answers the artist already gave come back without re-typing them', async ({ page }) => {
    await openHandin(page);

    // PR #1125's contract: a fact on record is shown as confirmed, not asked twice.
    await expect(page.getByText('State and LGA')).toBeVisible();
    await expect(page.getByText('Anambra · Awka North')).toBeVisible();
    await expect(page.getByText('spec.ng+openmic@gmail.com')).toBeVisible();
    await expect(page.getByText('From your entry. Change it if anything has moved.')).toBeVisible();
  });

  test('a completed hand-in is submittable', async ({ page }) => {
    await openHandin(page);

    // Whatever did not prefill, the artist types.
    await page.getByPlaceholder('What voters will see').fill('My Song');
    const stageName = page.getByPlaceholder('Exactly as it appears on your entry');
    if (await stageName.count()) await stageName.fill('hello new');
    const email = page.getByPlaceholder('you@example.com');
    if (await email.count()) await email.fill('spec.ng+openmic@gmail.com');
    if (await page.getByText('Select your state', { exact: true }).count()) {
      await chooseStateAndLga(page, 'Anambra', 'Awka North');
    }
    await page.getByPlaceholder('@yourhandle').first().fill('@hellonew');
    await pickSong(page);
    await tickAllDeclarations(page);

    // RNW emits no `aria-disabled` at all once a control is enabled, so the enabled
    // state is what has to be asserted here rather than an attribute value.
    await expect(submitButton(page)).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByText('Still needed:')).toHaveCount(0);
  });

  test('an incomplete hand-in says what is missing instead of sitting inert', async ({ page }) => {
    await openHandin(page);

    // The reported state: the MP3 is chosen, the fields are filled, one tick is
    // still outstanding. A disabled button cannot be pressed, so the card has to
    // say what it wants — otherwise the artist sees a dead control.
    await page.getByPlaceholder('What voters will see').fill('My Song');
    const stageName = page.getByPlaceholder('Exactly as it appears on your entry');
    if (await stageName.count()) await stageName.fill('hello new');
    const email = page.getByPlaceholder('you@example.com');
    if (await email.count()) await email.fill('spec.ng+openmic@gmail.com');
    if (await page.getByText('Select your state', { exact: true }).count()) {
      await chooseStateAndLga(page, 'Anambra', 'Awka North');
    }
    await page.getByPlaceholder('@yourhandle').first().fill('@hellonew');
    await pickSong(page);
    await page.getByText('I recorded this song over the official beat for this edition.').click();

    // No click needed, and no click possible: the explanation is on screen while the
    // button is still disabled, naming the two ticks that remain.
    await expect(
      page.getByText('Still needed: the ownership declaration, the sample declaration.'),
    ).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    // Ticking them takes the sentence away and frees the button — the list is the
    // same rule the gate uses, not a caption that can drift from it.
    await page.getByText('I own or have the rights to the lyrics and the recording I am submitting.').click();
    await page.getByText('It has no unauthorised samples, and I can perform it live if shortlisted.').click();
    await expect(page.getByText('Still needed:')).toHaveCount(0);
    await expect(submitButton(page)).toBeEnabled();
  });
});
