// The Open Mic create form used to offer only "paste a hosted URL", and the public
// beat reader allowlists /api/open-mic/beats/ — so every URL an operator could file
// here was one artists could not open. This guards the console that admins actually
// use: picking an mp3 uploads it through the web proxy and files the paths the
// server returns; a pasted URL that cannot play says so.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const uploadOpenMicBeat = vi.fn();
const createOpenMicContest = vi.fn();
vi.mock('@/services/openMicAdminService', () => ({
  uploadOpenMicBeat: (...a: unknown[]) => uploadOpenMicBeat(...a),
  createOpenMicContest: (...a: unknown[]) => createOpenMicContest(...a),
}));

// Vite does not resolve a Next route *directory*, so the page must be imported by
// file: `/page` is the module Next itself loads for `/admin/open-mic/new`. (The
// sibling precedent at tests/admin/crypto/reconciliation.test.tsx gets away with
// a bare directory only because a same-named file exists there.)
import NewOpenMicContestPage from '../../../app/admin/open-mic/new/page';

// The page calls useRouter() on render and vitest has no mounted Next app router,
// so every case dies on "invariant expected app router to be mounted" before it
// reaches the beat fields without this shim. Same mock this app already uses at
// src/components/guards/AdminRouteGuard.test.tsx:16; `push` is recorded so a later
// case can assert the post-create redirect.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// A real reader path: base64url of `openmic-beats/unassigned/a.mp3`, exactly what
// beatObjectKey() + encodeBeatFileKey() produce. An invented key would let this
// guard pass against a URL the server can never return.
const READER = '/api/open-mic/beats/b3Blbm1pYy1iZWF0cy91bmFzc2lnbmVkL2EubXAz';

beforeEach(() => {
  uploadOpenMicBeat.mockReset();
  createOpenMicContest.mockReset();
});
afterEach(() => cleanup());

function downloadField(): HTMLInputElement {
  return screen.getByLabelText(/Beat file URL \(Download\)/i) as HTMLInputElement;
}

function set(container: HTMLElement, id: string, value: string) {
  const el = container.querySelector(`#${id}`) as
    | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!el) throw new Error(`no field with id "${id}" — every gated input carries one`);
  fireEvent.change(el, { target: { value } });
}

/**
 * `errors` (page.tsx:69-86) gates title, slug, description, month, year, the two
 * weights, state, city, venue name and beat title. A submit-path case must satisfy
 * all of them except the beat, or it proves nothing: `createOpenMicContest` would go
 * uncalled for an unrelated empty field and the blocked case would pass for the wrong
 * reason. The weights default to 30/70 (`:55`) and already sum to 100. Fields are
 * addressed by `id`, not by label, because /Month/i matches both "Month*" and
 * "Repeat Months" once the labels gain `htmlFor`.
 */
function fillRequiredExceptBeat(container: HTMLElement) {
  set(container, 'open-mic-title', 'November Open Mic');
  set(container, 'open-mic-slug', 'november-open-mic');
  set(container, 'open-mic-description', 'Monthly Open Mic edition.');
  set(container, 'open-mic-month', '11');
  set(container, 'open-mic-year', '2026');
  set(container, 'open-mic-beat-title', 'Spotlight Beat');
  set(container, 'open-mic-venue-name', 'The Bridge');
  set(container, 'open-mic-state', 'Lagos');
  set(container, 'open-mic-city', 'Ikeja');
}

// Every case below renders the whole contest form (~0.4s per render in jsdom, 2s per
// case), which passes the 5s default alone and times out inside a parallel `npm test`.
// Same 20s budget as the other heavy component specs in this app (AdminSidebar).
describe('Open Mic beat upload in the admin console', () => {
  it('uploads the picked mp3, files both reader paths and warns about neither', async () => {
    uploadOpenMicBeat.mockResolvedValue({ previewUrl: READER, downloadUrl: `${READER}?download=1` });
    render(<NewOpenMicContestPage />);
    const file = new File([new Uint8Array([1, 2, 3])], 'beat.mp3', { type: 'audio/mp3' });
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), { target: { files: [file] } });
    // One async wait, not three. The download field can only hold that value after
    // uploadOpenMicBeat resolved, and its setField/setBeatNote commits land together,
    // so everything below is synchronous afterwards. This page costs ~0.4s per render
    // in jsdom; with three waits the case passed 2.1s alone and timed out at 5s inside
    // a full-suite run.
    await waitFor(() => expect(downloadField().value).toBe(`${READER}?download=1`));
    expect(uploadOpenMicBeat).toHaveBeenCalledTimes(1);
    expect(uploadOpenMicBeat.mock.calls[0][0]).toBe(file);
    expect(screen.getByLabelText(/Beat preview URL/i)).toHaveValue(READER);
    // An uploaded beat must read as *good*: nothing amber, and the confirmation in
    // its own tone rather than the error one — an operator who just uploaded should
    // not be shown #ea5455. The two absent warnings are also the only assertions that
    // pin BEAT_READER_BASE in this app's mirror: if that literal drifts from the
    // reader's, a real path stops matching the allowlist and both fail.
    expect(screen.queryByText(/Upload the mp3 instead/i)).toBeNull();
    expect(screen.queryByText(/before the public-beat fix/i)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/artists can now play and download/i);
    expect(screen.queryByRole('alert')).toBeNull();
  }, 20_000);

  it('surfaces the server error in the alert tone, not as silence', async () => {
    // Wording copied from the real route: a hand-declared Content-Type is what
    // breaks the boundary, and this is the answer it earns (415, not 400).
    uploadOpenMicBeat.mockRejectedValue(new Error('Beat upload failed: 415 — Expected multipart/form-data'));
    render(<NewOpenMicContestPage />);
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), {
      target: { files: [new File([new Uint8Array([1])], 'beat.mp3', { type: 'audio/mp3' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/415 — Expected multipart\/form-data/);
    expect(screen.queryByRole('status')).toBeNull();
    // The operator's next move is to correct the field by hand, and a red note left
    // hanging over a fixed value reads as "still failing".
    fireEvent.change(downloadField(), { target: { value: '/api/open-mic/beats/k' } });
    expect(screen.queryByRole('alert')).toBeNull();
  }, 20_000);

  it('warns about a pasted URL an artist cannot open', async () => {
    render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: 'https://cdn.example.com/beat.mp3' } });
    expect(await screen.findByText(/Upload the mp3 instead/i)).toBeInTheDocument();
  }, 20_000);

  it('names a pre-fix registration URL as legacy, not as a URL', async () => {
    render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: '/api/registration/uploads/abc' } });
    expect(await screen.findByText(/before the public-beat fix/i)).toBeInTheDocument();
  }, 20_000);

  it('refuses to publish a beat URL the reader cannot serve', async () => {
    // Spec decision D: what this console stores must be a reader path, so an
    // off-site URL has to stop the POST and say why in the field error — which is
    // the copy only a blocked submit produces. An amber line is not that guarantee.
    const { container } = render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: 'https://cdn.example.com/beat.mp3' } });
    fillRequiredExceptBeat(container);
    fireEvent.click(screen.getByRole('button', { name: /Create Monthly Contest/i }));
    expect(await screen.findByText(/cannot play that address/i)).toBeInTheDocument();
    expect(createOpenMicContest).not.toHaveBeenCalled();
  }, 20_000);

  it('publishes the reader path when the beat came from the picker', async () => {
    // The positive half of the pair: with every required field valid and the beat
    // uploaded, blocking would be a dead affordance instead of a guard.
    uploadOpenMicBeat.mockResolvedValue({ previewUrl: READER, downloadUrl: `${READER}?download=1` });
    createOpenMicContest.mockResolvedValue({ success: true });
    const { container } = render(<NewOpenMicContestPage />);
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), {
      target: { files: [new File([new Uint8Array([1])], 'beat.mp3', { type: 'audio/mp3' })] },
    });
    await waitFor(() => expect(downloadField().value).toBe(`${READER}?download=1`));
    fillRequiredExceptBeat(container);
    fireEvent.click(screen.getByRole('button', { name: /Create Monthly Contest/i }));
    await waitFor(() => expect(createOpenMicContest).toHaveBeenCalledTimes(1));
    const sent = createOpenMicContest.mock.calls[0][0] as { beat: { downloadUrl: string; previewUrl: string } };
    expect(sent.beat.downloadUrl).toBe(`${READER}?download=1`);
    expect(sent.beat.previewUrl).toBe(READER);
  }, 20_000);
});
