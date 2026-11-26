// The submission window is the setting that decides whether an approved artist
// can hand in a song at all, and the server's rule is strict: no dates and no
// `submission_open` status means every upload is refused. Before this tab
// exposed the two bounds, an operator could publish an edition, take
// applications, approve artists, and see zero songs arrive with nothing on
// screen pointing at the cause.
//
// `fetch` is stubbed rather than the service, so these cases cover the request
// the console actually makes — including the shape a datetime-local field has
// to be converted into before it is worth storing.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const PROXY = 'http://localhost:3001/api/web-proxy';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'c1' }) }));

function contest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    title: 'November Open Mic',
    slug: 'open-mic-november-2026',
    description: 'Monthly edition.',
    status: 'published',
    visibility: 'public',
    month: 11,
    year: 2026,
    season: 'Season 2026',
    registrationFeeNgn: 0,
    votingConfig: { votePrice: 50, freeVotesPerDay: 5 },
    finale: { venueName: 'Spotlight Lounge', venueType: 'lounge', address: 'Victoria Island', city: 'Lagos', state: 'Lagos' },
    prizes: [{ title: 'Monthly Winner Package' }],
    finalistsTarget: 10,
    selectionModel: 'hybrid',
    ...overrides,
  };
}

type Call = { url: string; method: string; body: string };
const calls: Call[] = [];
let stored = contest();

beforeEach(() => {
  calls.length = 0;
  stored = contest();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET');
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url, method, body });
    if (method === 'PATCH') {
      stored = { ...stored, ...(JSON.parse(body) as Record<string, unknown>) };
      return new Response(JSON.stringify({ success: true, contest: stored }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'POST' && url.endsWith('/api/admin/contests/banner')) {
      return new Response(JSON.stringify({
        success: true,
        upload: { url: '/api/admin/contests/banner/YmFubmVyLWtleQ' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/admin/open-mic/contests/c1')) {
      return new Response(JSON.stringify({ success: true, contest: stored }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderConsole() {
  const DetailPage = (await import('../../../app/admin/open-mic/[id]/page')).default;
  render(<DetailPage />);
  await screen.findByDisplayValue('November Open Mic');
}

describe('the submission window in the contest editor', () => {
  it('names an edition with no dates as closed', async () => {
    await renderConsole();
    // Not "open", not blank: the sentence has to match what the presign route
    // will do to the next artist, and offer the two ways out.
    expect(await screen.findByText(/cannot hand in a song/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Submissions Open From/i)).toHaveValue('');
    expect(screen.getByLabelText(/Submissions Close At/i)).toHaveValue('');
  });

  it('saves the picked wall clock as an instant the server can compare', async () => {
    await renderConsole();
    fireEvent.change(screen.getByLabelText(/Submissions Open From/i), { target: { value: '2026-11-20T09:00' } });
    fireEvent.change(screen.getByLabelText(/Submissions Close At/i), { target: { value: '2026-11-27T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = JSON.parse(calls.find((call) => call.method === 'PATCH')!.body) as Record<string, unknown>;
    expect(patch.submissionStartAt).toBe(new Date('2026-11-20T09:00:00').toISOString());
    expect(patch.submissionEndAt).toBe(new Date('2026-11-27T18:00:00').toISOString());
    // PATCH merges {...existing, ...patch}, so both keys must always be present:
    // omitting one would leave a date the operator just cleared in place.
    expect('submissionStartAt' in patch).toBe(true);
    expect('submissionEndAt' in patch).toBe(true);
  });

  it('shows a stored instant in the picker instead of leaving it blank to be erased', async () => {
    // A seeded edition holds `...Z` ISO. Handing that raw to a datetime-local
    // field renders empty — and the next unrelated save would then wipe a window
    // that was working.
    stored = contest({ submissionStartAt: '2026-11-01T00:00:00.000Z', submissionEndAt: '2026-12-31T23:59:59.000Z' });
    await renderConsole();
    expect(screen.getByLabelText(/Submissions Open From/i)).not.toHaveValue('');
    expect(screen.getByLabelText(/Submissions Close At/i)).not.toHaveValue('');
    // And the window it describes is open, so the notice must not be amber.
    expect(screen.queryByText(/cannot hand in a song/i)).toBeNull();
  });

  it('refuses to store a window that closes before it opens', async () => {
    await renderConsole();
    fireEvent.change(screen.getByLabelText(/Submissions Open From/i), { target: { value: '2026-11-27T18:00' } });
    fireEvent.change(screen.getByLabelText(/Submissions Close At/i), { target: { value: '2026-11-20T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not after the open date/i);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('uploads and saves a replacement banner', async () => {
    stored = contest({ bannerImageUrl: '/api/admin/contests/banner/b2xkLWtleQ' });
    await renderConsole();
    const file = new File(['image'], 'new-banner.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('Contest banner image'), { target: { files: [file] } });

    expect(await screen.findByRole('img', { name: 'Contest banner preview' })).toHaveAttribute(
      'src',
      expect.stringContaining('/api/admin/contests/banner/YmFubmVyLWtleQ'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = JSON.parse(calls.find((call) => call.method === 'PATCH')!.body) as Record<string, unknown>;
    expect(patch.bannerImageUrl).toBe('/api/admin/contests/banner/YmFubmVyLWtleQ');
  });

  it('removes the banner from the contest when changes are saved', async () => {
    stored = contest({ bannerImageUrl: '/api/admin/contests/banner/YmFubmVyLWtleQ' });
    await renderConsole();

    fireEvent.click(screen.getByRole('button', { name: /Remove banner/i }));
    expect(screen.getByText(/No banner is set for this edition/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = JSON.parse(calls.find((call) => call.method === 'PATCH')!.body) as Record<string, unknown>;
    expect(patch.bannerImageUrl).toBe('');
  });
});
