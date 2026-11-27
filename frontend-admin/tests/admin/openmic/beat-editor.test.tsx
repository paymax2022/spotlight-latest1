// The edition detail console had a banner picker and a Beat Downloads analytics
// tab, but no way to attach the beat itself — so an operator staring at a
// contestant's "beat not available" 404 had nowhere on this page to fix it, and
// had to go to the creation form (which cannot target an existing edition).
//
// Two requests are involved, and the test pins both, because only one of them is
// durable: POST /api/admin/open-mic/beats stores the bytes and answers with
// reader paths, while PATCH /api/admin/open-mic/contests/:id never writes a beat
// row (updateContest has no beat column mapping — the patch lands in the in-memory
// projection and disappears). The row lives in competition_beats, written by
// POST /api/admin/open-mic/contests/:id/beats (upsertBeat), which is also what
// retires the previous beat so exactly one is active.
//
// `fetch` is stubbed, not the service, so these cases cover the requests the
// console actually makes. Same shape as submission-window-editor.test.tsx.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'c1' }) }));

import OpenMicContestDetailPage from '../../../app/admin/open-mic/[id]/page';

// base64url of `openmic-beats/c1/a.mp3` — what beatObjectKey() +
// encodeBeatFileKey() actually produce for this edition. A made-up key would let
// the "unplayable" guard pass against a URL the server can never return.
const READER = '/api/open-mic/beats/b3Blbm1pYy1iZWF0cy9jMS9hLm1wMw';

type Call = { url: string; method: string; body: string; isForm: boolean };
const calls: Call[] = [];
let stored: Record<string, unknown> = {};

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
    entryFeeRequired: false,
    votingConfig: { votePrice: 50, freeVotesPerDay: 5 },
    finale: { venueName: 'Spotlight Lounge', venueType: 'lounge', address: 'Victoria Island', city: 'Lagos', state: 'Lagos' },
    prizes: [{ title: 'Monthly Winner Package' }],
    finalistsTarget: 10,
    selectionModel: 'hybrid',
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  stored = contest();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET');
    const isForm = init.body instanceof FormData;
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url, method, body, isForm });
    const json = (status: number, payload: Record<string, unknown>) =>
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'PATCH') {
      stored = { ...stored, ...(JSON.parse(body) as Record<string, unknown>) };
      return json(200, { success: true, contest: stored });
    }
    // Byte upload (multipart). Must be matched before the JSON beat route below,
    // which shares the `/beats` suffix.
    if (method === 'POST' && isForm) {
      return json(201, {
        success: true,
        beat: { objectKey: 'openmic-beats/c1/a.mp3', previewUrl: READER, downloadUrl: `${READER}?download=1`, fileName: 'beat.mp3', sizeBytes: 3 },
      });
    }
    if (method === 'POST' && url.endsWith('/api/admin/open-mic/contests/c1/beats')) {
      return json(201, { success: true, beat: { id: 'beat-1', ...(JSON.parse(body) as Record<string, unknown>) } });
    }
    if (url.endsWith('/api/admin/open-mic/contests/c1')) {
      return json(200, { success: true, contest: stored });
    }
    return json(200, { success: true });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openEditor() {
  render(<OpenMicContestDetailPage />);
  await screen.findByDisplayValue('November Open Mic');
}

function beatCalls(): Call[] {
  return calls.filter((call) => call.method === 'POST' && !call.isForm && call.url.endsWith('/contests/c1/beats'));
}

async function pickBeat() {
  fireEvent.change(screen.getByLabelText('Open Mic beat file'), {
    target: { files: [new File([new Uint8Array([1, 2, 3])], 'beat.mp3', { type: 'audio/mp3' })] },
  });
  await waitFor(() => expect(calls.some((call) => call.isForm)).toBe(true));
}

describe('the official beat in the edition console', () => {
  it('offers an mp3 picker for an edition that has no beat', async () => {
    await openEditor();
    expect(screen.getByText('Official Beat')).toBeInTheDocument();
    // The empty state has to name the consequence, because "No beat" alone reads
    // like a cosmetic gap and not like the 404 an artist is reporting.
    expect(await screen.findByText(/no beat is filed/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Open Mic beat file')).toHaveAttribute('accept', '.mp3');
  }, 20_000);

  it('stores the uploaded file against this edition and files the reader paths on save', async () => {
    stored = contest({ entryFeeRequired: true });
    await openEditor();
    await pickBeat();
    // The contest id belongs in the upload: it is part of the object key, so an
    // upload without it lands under `unassigned` and cannot be traced to an edition.
    const upload = calls.find((call) => call.isForm)!;
    expect(upload.url).toContain('/api/admin/open-mic/beats?contestId=c1');
    // Exact, not /save changes to publish/i: the banner card above says the same
    // thing about the image, and a loose matcher would pass on the banner's note.
    expect(await screen.findByText('Beat uploaded. Save changes to publish it for this edition.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Official Beat Title/i), { target: { value: 'Spotlight November Riddim' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(beatCalls().length).toBe(1));
    const filed = JSON.parse(beatCalls()[0].body) as Record<string, unknown>;
    expect(filed.downloadUrl).toBe(`${READER}?download=1`);
    expect(filed.previewUrl).toBe(READER);
    expect(filed.beatTitle).toBe('Spotlight November Riddim');
    expect(filed.allowDownload).toBe(true);
    // Mirrors the legacy editor: the beat's own gate follows the edition's paid
    // entry flag, so the row cannot contradict what Registration says on screen.
    expect(filed.requiresPaidEntryForDownload).toBe(true);
  }, 20_000);

  it('refuses to file an uploaded beat it would have to name "Official Beat"', async () => {
    // An anonymous beat is the half-finished state this page used to leave people
    // in: the file is in storage, no row points at it, and the artist still gets
    // "Beat is not available for this contest". Saying so has to stop the save.
    await openEditor();
    await pickBeat();
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    expect(await screen.findByText(/Official beat title is required/i)).toBeInTheDocument();
    expect(beatCalls().length).toBe(0);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  }, 20_000);

  it('shows the beat an edition already has', async () => {
    stored = contest({
      beat: {
        beatTitle: 'Season Opener', producerName: 'Producer B', producerCredit: 'Producer B',
        previewUrl: READER, downloadUrl: `${READER}?download=1`, usageRules: 'Contest use only.',
      },
    });
    await openEditor();
    expect(await screen.getByDisplayValue('Season Opener')).toBeInTheDocument();
    expect(screen.getByDisplayValue(READER)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Contest use only.')).toBeInTheDocument();
    expect(screen.queryByText(/no beat is filed/i)).toBeNull();
  }, 20_000);

  it('names a beat filed before the public-reader fix as one artists cannot open', async () => {
    stored = contest({
      beat: {
        beatTitle: 'Old Beat', producerName: 'X', producerCredit: 'X',
        previewUrl: '/api/registration/uploads/abc', downloadUrl: '/api/registration/uploads/abc',
        usageRules: 'Contest use only.',
      },
    });
    await openEditor();
    expect(await screen.findByText(/before the public-beat fix/i)).toBeInTheDocument();
  }, 20_000);

  it('leaves an untouched beat alone when other fields are saved', async () => {
    stored = contest({
      beat: { beatTitle: 'Keep Me', producerName: 'X', producerCredit: 'X', previewUrl: READER, downloadUrl: READER, usageRules: 'Rules.' },
    });
    await openEditor();
    fireEvent.change(screen.getByLabelText(/Submissions Close At/i), { target: { value: '2026-12-31T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    // Writing a beat row the operator never edited would retire and re-file the
    // active row (upsertBeat retires by id), so a plain metadata save must not touch it.
    expect(beatCalls().length).toBe(0);
  }, 20_000);

  it('surfaces a refused upload instead of failing silently', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = String(init.method || 'GET');
      if (method === 'POST') {
        return new Response(JSON.stringify({ success: false, error: 'Beat must be an MP3 file' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, contest: stored }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    stored = contest();
    await openEditor();
    fireEvent.change(screen.getByLabelText('Open Mic beat file'), {
      target: { files: [new File([new Uint8Array([1])], 'beat.wav', { type: 'audio/wav' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Beat must be an MP3 file/);
    expect(beatCalls().length).toBe(0);
  }, 20_000);
});
