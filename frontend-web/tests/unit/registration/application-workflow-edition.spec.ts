/**
 * The Open Mic progress panel is built from `getApplicationWorkflow`, and until
 * now that reader resolved the edition with a single exact slug lookup against
 * `contests`. A registration row stores the CATALOG slug (`open-mic-competition`)
 * while the published edition has its own, so the lookup missed and the workflow
 * answered `isOpenMic: false` — the artist who had just been approved saw no beat
 * download and no song upload, on the phone and on the web.
 *
 * The reported case is real: registration `9e97516a…` (ref OPENMI-762024-2XQIBW)
 * carries `contest_slug = open-mic-competition` with `contest.type =
 * one_beat_one_verse`, and no `contests` row has that slug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRegistrationDraft = vi.hoisted(() => vi.fn());
const getContestBySlug = vi.hoisted(() => vi.fn());
const listContests = vi.hoisted(() => vi.fn());
const latestBeatDownloadAt = vi.hoisted(() => vi.fn());
const listSubmissions = vi.hoisted(() => vi.fn());

vi.mock('@/src/server/registration/supabase-store', () => ({ getRegistrationDraft }));
vi.mock('@/src/server/openmic/persistence', () => ({
  getContestBySlug,
  listContests,
  latestBeatDownloadAt,
  listSubmissions,
}));

import { getApplicationWorkflow } from '@/src/server/registration-v2/workflow-steps';

const LIVE_EDITION = {
  id: 'edition-live',
  slug: 'open-mic-dev',
  title: 'November Open Mic',
  description: 'One beat, one verse.',
  status: 'submission_open',
};

beforeEach(() => {
  getRegistrationDraft.mockReset();
  getContestBySlug.mockReset();
  listContests.mockReset();
  latestBeatDownloadAt.mockReset();
  listSubmissions.mockReset();
  getContestBySlug.mockResolvedValue(null);
  latestBeatDownloadAt.mockResolvedValue(null);
  listSubmissions.mockResolvedValue([]);
});

describe('getApplicationWorkflow — edition resolution', () => {
  it('reads the beat step of a catalog-slug application against the live edition', async () => {
    getRegistrationDraft.mockResolvedValue({
      id: '9e97516a-0000-0000-0000-000000000000',
      userId: 'artist-1',
      contestSlug: 'open-mic-competition',
      status: 'approved',
      formData: { 'contest.type': 'one_beat_one_verse', 'contest.category': 'open_mic' },
    });
    listContests.mockResolvedValue([LIVE_EDITION]);
    latestBeatDownloadAt.mockResolvedValue('2026-11-20T10:00:00.000Z');

    const workflow = await getApplicationWorkflow('9e97516a-0000-0000-0000-000000000000');

    expect(workflow?.isOpenMic).toBe(true);
    // The edition the artist is pointed at is the live one, and its slug is what a
    // client must use for every later call — the catalog slug has no beat behind it.
    expect(workflow?.edition).toMatchObject({ id: 'edition-live', slug: 'open-mic-dev' });
    expect(latestBeatDownloadAt).toHaveBeenCalledWith({ contestId: 'edition-live', userId: 'artist-1' });
    expect(listSubmissions).toHaveBeenCalledWith({ contestId: 'edition-live', userId: 'artist-1' });
    expect(workflow?.steps).toEqual([
      { id: 'beat-downloaded', kind: 'beat_downloaded', label: 'Beat downloaded', at: '2026-11-20T10:00:00.000Z' },
    ]);
  });

  it('resolves an application whose slug does name a contests row without any fallback', async () => {
    getRegistrationDraft.mockResolvedValue({
      id: 'reg-2',
      userId: 'artist-2',
      contestSlug: 'open-mic-christmas-edition',
      status: 'approved',
      formData: {},
    });
    getContestBySlug.mockResolvedValue({ ...LIVE_EDITION, id: 'edition-xmas', slug: 'open-mic-christmas-edition' });

    const workflow = await getApplicationWorkflow('reg-2');

    expect(workflow?.edition).toMatchObject({ id: 'edition-xmas' });
    expect(listContests).not.toHaveBeenCalled();
  });

  it('shows no Open Mic panel for a different contest, even when an edition is live', async () => {
    getRegistrationDraft.mockResolvedValue({
      id: 'reg-3',
      userId: 'artist-3',
      contestSlug: 'talent-search-2026',
      status: 'approved',
      formData: { 'contest.type': 'online_contest', 'contest.category': 'entertainment' },
    });

    const workflow = await getApplicationWorkflow('reg-3');

    expect(workflow).toEqual({ isOpenMic: false, edition: null, steps: [] });
    expect(listContests).not.toHaveBeenCalled();
    expect(latestBeatDownloadAt).not.toHaveBeenCalled();
  });

  it('shows no panel when the catalog slug matches nothing live', async () => {
    getRegistrationDraft.mockResolvedValue({
      id: 'reg-4',
      userId: 'artist-4',
      contestSlug: 'open-mic-competition',
      status: 'pending',
      formData: { 'contest.category': 'open_mic' },
    });
    listContests.mockResolvedValue([{ ...LIVE_EDITION, id: 'ended', status: 'winner_announced' }]);

    const workflow = await getApplicationWorkflow('reg-4');

    // An Open Mic application with no live edition has nothing to render: no beat,
    // no window, no board. `isOpenMic: false` is the honest answer and the one the
    // screens already handle; an invented edition would be worse.
    expect(workflow).toEqual({ isOpenMic: false, edition: null, steps: [] });
    expect(latestBeatDownloadAt).not.toHaveBeenCalled();
  });

  it('reads the identity the registration plane locked when the slug names no row', async () => {
    getRegistrationDraft.mockResolvedValue({
      id: 'reg-5',
      userId: 'artist-5',
      // An admin renamed the edition; the application still carries the old slug.
      contestSlug: 'spotlight-open-mic-2026-11',
      status: 'approved',
      formData: { 'contest.type': 'one_beat_one_verse', 'contest.category': 'entertainment' },
    });
    listContests.mockResolvedValue([LIVE_EDITION]);
    latestBeatDownloadAt.mockResolvedValue('2026-11-21T09:00:00.000Z');

    const workflow = await getApplicationWorkflow('reg-5');

    // `contest.type` on the draft is the only thing left that says Open Mic, so it
    // has to be the thing this reader passes on.
    expect(workflow?.edition).toMatchObject({ id: 'edition-live', slug: 'open-mic-dev' });
    expect(workflow?.steps).toEqual([
      { id: 'beat-downloaded', kind: 'beat_downloaded', label: 'Beat downloaded', at: '2026-11-21T09:00:00.000Z' },
    ]);
  });

  it('still throws for a missing registration id', async () => {
    await expect(getApplicationWorkflow('')).rejects.toThrow('Invalid registration id');
  });
});
