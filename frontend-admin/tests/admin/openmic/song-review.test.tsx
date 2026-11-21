// The Open Mic console used to be read-only for songs: an operator could see a
// hand-in and its status, but the approve/reject/publish decision — the thing
// that decides whether voters hear the track at all — lived only on
// frontend-web's own admin page. These cases guard the wiring that closes that
// gap: the decision reaches the review route in the server's field names,
// through the web proxy, and the audio is fetched only when asked for.
//
// The second group guards the review screen as a *queue*: the tab renders every
// song twice (a table above a card per row) used to be the operator's whole
// triage, with decided songs interleaved with the ones needing work, no way to
// narrow the list, and `approved` — the decision that shows the song to nobody —
// pre-selected on every row.
//
// `fetch` is stubbed rather than the service, so what is asserted is the whole
// client chain (panel → service → webProxyBase → request), which is exactly the
// part that can be silently wrong: a body field named `decision` instead of
// `status`, or a song path that skips the proxy and 404s in this app.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import OpenMicSubmissionReviewPanel from '@/features/openmic/song-review-panel';
import { OPEN_MIC_REVIEW_DECISION_HINTS } from '@/features/openmic/review-decisions';
import type { OpenMicSubmissionRow } from '@/services/openMicAdminService';

// Same origin jsdom is configured with (vitest.config.ts environmentOptions),
// and the same base the service builds requests from.
const PROXY = 'http://localhost:3001/api/web-proxy';

function submission(overrides: Partial<OpenMicSubmissionRow> = {}): OpenMicSubmissionRow {
  return {
    id: 'sub-1',
    stageName: 'Laga Laga',
    songTitle: 'One Shot',
    status: 'submitted',
    voteCount: 0,
    isFinalist: false,
    isWinner: false,
    genre: 'Afro-fusion',
    submittedAt: '2026-11-18T09:00:00.000Z',
    songUrl: '/api/open-mic/songs/sub-1',
    songObjectKey: 'openmic-songs/sub-1.mp3',
    ...overrides,
  } as OpenMicSubmissionRow;
}

type Call = { url: string; method: string; body: string };
const calls: Call[] = [];
/** Answers keyed by what the path ends with, so each case states only its own route. */
let responder: (url: string) => { ok: boolean; status: number; json: unknown } = () => ({ ok: true, status: 200, json: {} });

function lastCall(): Call {
  const call = calls[calls.length - 1];
  if (!call) throw new Error('no request was made');
  return call;
}

/** The card a row renders into, so a case with several rows can address one. */
function card(id: string): HTMLElement {
  return screen.getByTestId(`submission-card-${id}`);
}

function cardIds(): string[] {
  return screen
    .queryAllByTestId(/^submission-card-/)
    .map((el) => String(el.getAttribute('data-testid')).replace('submission-card-', ''));
}

beforeEach(() => {
  calls.length = 0;
  responder = () => ({ ok: true, status: 200, json: {} });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: String(init.method || 'GET'), body: typeof init.body === 'string' ? init.body : '' });
    const answer = responder(url);
    return new Response(JSON.stringify(answer.json), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Open Mic song review in the admin console', () => {
  it('posts the chosen decision as the server reads it', async () => {
    responder = () => ({ ok: true, status: 200, json: { success: true, submission: submission({ status: 'rejected' }) } });
    render(<OpenMicSubmissionReviewPanel submissions={[submission()]} onRefresh={() => {}} />);

    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'rejected' } });
    fireEvent.change(screen.getByLabelText('Note to the artist'), { target: { value: 'The verse is the beat’s own demo.' } });
    fireEvent.click(screen.getByRole('button', { name: /Reject song/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(lastCall().method).toBe('POST');
    // The route is frontend-web's, reached through this app's proxy, and the body
    // uses the server's names: `status` and `note`. A client that sent
    // `decision`/`feedback` would earn a 400 `status is required`.
    expect(lastCall().url).toBe(`${PROXY}/api/admin/open-mic/submissions/sub-1/review`);
    expect(JSON.parse(lastCall().body)).toEqual({ status: 'rejected', note: 'The verse is the beat’s own demo.' });
    expect(await screen.findByRole('status')).toHaveTextContent(/status is now “rejected”/i);
  });

  it('does not ask for a song until the operator presses play, then asks the proxy', async () => {
    // The proxy buffers the whole body and does not forward Range, so a list that
    // fetched eagerly would download every mp3 on open and could not seek.
    responder = () => ({ ok: true, status: 200, json: { success: true, signedUrl: '/api/open-mic/songs/sub-1' } });
    render(<OpenMicSubmissionReviewPanel submissions={[submission()]} onRefresh={() => {}} />);
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Play song/i }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/api/admin/open-mic/submissions/sub-1/song'))).toBe(true));
    expect(calls.filter((call) => call.url.endsWith('/song'))).toHaveLength(1);
    // The local answer is a root-relative reader path, which is only playable from
    // this app once the proxy base is prefixed in front of it.
    expect((await screen.findByTestId('song-player-sub-1'))).toHaveAttribute('src', `${PROXY}/api/open-mic/songs/sub-1`);
  });

  it('passes an absolute signed URL through untouched', async () => {
    // In an R2 deployment the server signs the bucket URL itself; prefixing that
    // with the proxy base would produce a doubled, unreachable address.
    responder = () => ({ ok: true, status: 200, json: { success: true, signedUrl: 'https://bucket.r2.cloudflarestorage.com/openmic-songs/sub-1.mp3?X-Amz-Signature=abc' } });
    render(<OpenMicSubmissionReviewPanel submissions={[submission()]} onRefresh={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Play song/i }));
    expect(await screen.findByTestId('song-player-sub-1')).toHaveAttribute(
      'src',
      'https://bucket.r2.cloudflarestorage.com/openmic-songs/sub-1.mp3?X-Amz-Signature=abc',
    );
  });

  it('asks the download route, not the playback route, when the operator wants the file', async () => {
    responder = () => ({ ok: true, status: 200, json: { success: true, signedUrl: '/api/open-mic/songs/sub-1?download=1' } });
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
    render(<OpenMicSubmissionReviewPanel submissions={[submission()]} onRefresh={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Download$/i }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/submissions/sub-1/song?download=1'))).toBe(true));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('keeps the button dead until a decision that messages the artist carries a note', async () => {
    // A blank note is what sends the artist "Please review admin feedback on your
    // submission." with nothing to act on; the server accepts it, so the console
    // is the only place that can stop it.
    responder = () => ({ ok: true, status: 200, json: { success: true, submission: submission({ status: 'rejected' }) } });
    render(<OpenMicSubmissionReviewPanel submissions={[submission()]} onRefresh={() => {}} />);
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'rejected' } });
    expect(screen.getByRole('button', { name: /Reject song/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/write the note first/i);

    fireEvent.change(screen.getByLabelText('Note to the artist'), { target: { value: 'Re-record the hook clean.' } });
    expect(screen.getByRole('button', { name: /Reject song/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Reject song/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('lets a decision that notifies nobody through with no note at all', async () => {
    // The other half of the pair above: gating `finalist` on a note would be a
    // dead affordance, since that decision reaches no artist.
    responder = () => ({ ok: true, status: 200, json: { success: true, submission: submission({ status: 'finalist' }) } });
    render(<OpenMicSubmissionReviewPanel submissions={[submission()]} onRefresh={() => {}} />);
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'finalist' } });
    const apply = screen.getByRole('button', { name: /Apply/i });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(lastCall().body)).toEqual({ status: 'finalist', note: '' });
  });

  it('says the server refused instead of pretending the row is decided', async () => {
    // The review route is assertOpenMicScoreAdmin: a narrower role than the one
    // that may read this tab, so 403 is a real answer an operator hits.
    responder = () => ({ ok: false, status: 403, json: { error: 'Forbidden' } });
    render(<OpenMicSubmissionReviewPanel submissions={[submission()]} onRefresh={() => {}} />);
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'disqualified' } });
    fireEvent.click(screen.getByRole('button', { name: /Disqualify song/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/403/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers no playback for a hand-in that has no song on file', () => {
    render(
      <OpenMicSubmissionReviewPanel
        submissions={[submission({ songUrl: undefined, songObjectKey: undefined })]}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Play song/i })).toBeDisabled();
    expect(screen.getByText(/not handed a song in yet/i)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('refreshes the list after a decision so the queue shows the new status', async () => {
    responder = () => ({ ok: true, status: 200, json: { success: true, submission: submission({ status: 'published_for_voting' }) } });
    const onRefresh = vi.fn();
    render(
      <OpenMicSubmissionReviewPanel
        submissions={[submission()]}
        onRefresh={onRefresh}
        refreshing={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('Note to the artist'), { target: { value: 'You are on the leaderboard.' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply/i }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });
});

describe('Open Mic submissions as a review queue', () => {
  const pending = submission({ id: 'p1', stageName: 'Laga Laga', songTitle: 'One Shot', submittedAt: '2026-11-19T09:00:00.000Z' });
  const olderPending = submission({ id: 'p2', stageName: 'Tunde', songTitle: 'Night Run', submittedAt: '2026-11-17T09:00:00.000Z' });
  const published = submission({ id: 'd1', stageName: 'Bisi', songTitle: 'Owambe', status: 'published_for_voting', submittedAt: '2026-11-20T09:00:00.000Z' });

  it('shows the hand-ins that still need a decision first, and hides the decided ones', () => {
    render(<OpenMicSubmissionReviewPanel submissions={[published, olderPending, pending]} onRefresh={() => {}} />);
    // The default scope is the backlog: newest hand-in first, decided songs out.
    expect(cardIds()).toEqual(['p1', 'p2']);
    expect(screen.getByText(/2 awaiting a decision/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Which hand-ins to show'), { target: { value: 'all' } });
    expect(cardIds()).toEqual(['p1', 'p2', 'd1']);
  });

  it('narrows the queue by artist or song name', () => {
    render(<OpenMicSubmissionReviewPanel submissions={[published, olderPending, pending]} onRefresh={() => {}} />);
    fireEvent.change(screen.getByLabelText('Which hand-ins to show'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search hand-ins'), { target: { value: 'night' } });
    expect(cardIds()).toEqual(['p2']);
  });

  it('says when nothing matches, and offers one click back to the whole queue', () => {
    render(<OpenMicSubmissionReviewPanel submissions={[published, olderPending, pending]} onRefresh={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search hand-ins'), { target: { value: 'zzz' } });
    expect(cardIds()).toEqual([]);
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(cardIds()).toEqual(['p1', 'p2']);
    expect(screen.queryByText(/nothing matches/i)).toBeNull();
  });

  it('starts on the decision that actually puts the song in front of voters', () => {
    render(<OpenMicSubmissionReviewPanel submissions={[pending]} onRefresh={() => {}} />);
    // `approved` alone accepts the file and shows it to nobody, so pre-selecting
    // it made the silent outcome the one-click path on every row.
    expect((screen.getByLabelText('Decision') as HTMLSelectElement).value).toBe('published_for_voting');
    // …which is also a decision that messages the artist, so it cannot fire blank.
    expect(screen.getByRole('button', { name: /Apply/i })).toBeDisabled();
  });

  it('says what the chosen decision does before the operator commits to it', () => {
    render(<OpenMicSubmissionReviewPanel submissions={[pending]} onRefresh={() => {}} />);
    // OPEN_MIC_REVIEW_DECISION_HINTS existed for exactly this and was never rendered.
    expect(screen.getByText(OPEN_MIC_REVIEW_DECISION_HINTS.published_for_voting)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'approved' } });
    expect(screen.getByText(OPEN_MIC_REVIEW_DECISION_HINTS.approved)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_MIC_REVIEW_DECISION_HINTS.published_for_voting)).toBeNull();
  });

  it('carries the facts the separate table used to hold', () => {
    render(
      <OpenMicSubmissionReviewPanel
        submissions={[submission({ id: 'f1', isFinalist: true, isWinner: true, voteCount: 41, submittedAt: '2026-11-18T09:00:00.000Z' })]}
        onRefresh={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Which hand-ins to show'), { target: { value: 'all' } });
    const row = card('f1');
    expect(within(row).getByText('Finalist')).toBeInTheDocument();
    expect(within(row).getByText('Winner')).toBeInTheDocument();
    expect(within(row).getByText(/41 votes/i)).toBeInTheDocument();
    expect(within(row).getByText(/18 Nov 2026/i)).toBeInTheDocument();
  });

  it('leaves the timestamp clause out for a hand-in that carries none', () => {
    // The card used to read "handed in no timestamp" for a row whose
    // `submittedAt` was missing or unparsable; the clause goes instead.
    render(
      <OpenMicSubmissionReviewPanel
        submissions={[submission({ id: 'n1', submittedAt: undefined })]}
        onRefresh={() => {}}
      />,
    );
    expect(within(card('n1')).queryByText(/handed in/i)).toBeNull();
    // …without taking the rest of the meta line with it.
    expect(within(card('n1')).getByText(/Laga Laga · Afro-fusion/)).toBeInTheDocument();
  });

  it('moves the operator to the next undecided hand-in once this one is decided', async () => {
    responder = () => ({ ok: true, status: 200, json: { success: true, submission: submission({ id: 'p1', status: 'published_for_voting' }) } });
    const onRefresh = vi.fn();
    render(<OpenMicSubmissionReviewPanel submissions={[pending, olderPending]} onRefresh={onRefresh} />);

    fireEvent.change(within(card('p1')).getByLabelText('Note to the artist'), { target: { value: 'On the leaderboard.' } });
    fireEvent.click(within(card('p1')).getByRole('button', { name: /Apply/i }));

    // The card stays mounted — losing the confirmation the operator just earned
    // is what the old reload-the-tab behaviour did — and its pill shows the new
    // status without waiting for the refetch.
    await waitFor(() => expect(card('p1')).toBeInTheDocument());
    await waitFor(() => expect(within(card('p1')).getByTestId('submission-status-p1')).toHaveTextContent(/published for voting/i));
    // …while the keyboard lands on the row that still needs work.
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('decision-p2')));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
