/**
 * The contestant profile picture: its frame and its source.
 *
 * FRAME. The slot was `width: 100%, height: 180, objectFit: 'cover'` inside a
 * half-width card — a landscape letterbox of what is almost always a portrait
 * headshot. `cover` scales the source to fill the box and cuts what does not
 * fit, so a 3:4 photo in a 340×180 slot loses roughly the top third: exactly
 * the part with the face. An operator checking a contestant's identity photo was
 * being shown a crop of it. So the frame is portrait (3:4) and the fit is
 * `contain`, which shows the whole image; because `contain` leaves bands above
 * and below a wide source, the frame carries a background and a border and reads
 * as a frame rather than as a broken image. The no-photo placeholder uses the
 * same frame: two different boxes for the same slot is how a card jumps as it
 * loads. (Frame half landed on `main` as PR #1139.)
 *
 * SOURCE. The `src` is not `photo_url`. `getContestant` reads the Go connect
 * roster, which returns that column as a presigned R2 GET. In a deployment where
 * the registration upload went to the web app's local fallback store instead of
 * the bucket — every localhost run, and any object uploaded before R2 was
 * configured — the signature is valid and the object is missing, so the tag
 * rendered a broken-image box (measured: `naturalWidth: 0` for the reported
 * contestant, R2 answering 404 NoSuchKey). The web plane owns both stores, so
 * the console asks it: /api/web-proxy/api/admin/voting/contestants/:id/photo
 * reads the stored row and answers with local bytes, a confirmed bucket
 * redirect, or a 404. `onError` is the other half — without it a 404 leaves the
 * browser's broken icon on screen instead of the placeholder the rest of the
 * console already falls back to.
 *
 * Harness follows contestant-nav.test.tsx in this directory.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const CONTESTANT_ID = '01e02692-d38b-4f84-b13c-9363e4ab528d';

const base = {
  contestant_id: CONTESTANT_ID,
  name: 'hello new',
  stage_name: '',
  category: 'Singing',
  state: 'Anambra',
  bio: '',
  photo_url: '',
  media_url: '',
  status: 'approved',
  is_active: true,
  free_votes: 0,
  paid_votes: 0,
  total_votes: 0,
  rank: 1,
};

// Swapped per case: whether this contestant has a photo on file at all.
let entry: Record<string, unknown> = { ...base };

// What the roster actually returns for a registration upload: a presigned bucket
// URL whose object is not in that bucket.
const SIGNED_BUCKET_URL =
  'https://account.r2.cloudflarestorage.com/spotlight-openmic-songs/registration/x/y.jpg?X-Amz-Signature=deadbeef';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: entry.contestant_id }),
}));

vi.mock('@/services/competitionsService', () => ({
  getContestant: vi.fn(async () => entry),
  castAdminVote: vi.fn(async () => ({})),
}));

import ContestantProfilePage from './page';

/** The numbers React wrote into the inline style, as the browser sees them. */
function frame(img: HTMLElement): { width: number; height: number; fit: string | null } {
  return {
    width: Number(img.style.width.replace(/[^0-9.]/g, '')),
    height: Number(img.style.height.replace(/[^0-9.]/g, '')),
    fit: img.style.objectFit,
  };
}

describe('contestant profile picture', () => {
  it('frames a headshot portrait and shows all of it', async () => {
    entry = { ...base, photo_url: SIGNED_BUCKET_URL };
    render(<ContestantProfilePage />);

    const img = await screen.findByRole('img', { name: 'hello new' });
    const { width, height, fit } = frame(img);
    // Taller than wide, the way a person is photographed for a profile — 3:4.
    expect(height).toBeGreaterThan(width);
    expect([width, height]).toEqual([240, 320]);
    // …and uncropped: `cover` would fill the frame by cutting the top off.
    expect(fit).toBe('contain');
  });

  it('gives the frame a surface, because contain letterboxes a wide source', async () => {
    entry = { ...base, photo_url: SIGNED_BUCKET_URL };
    render(<ContestantProfilePage />);

    const img = await screen.findByRole('img', { name: 'hello new' });
    expect(img.style.background).not.toBe('');
    expect(img.style.border).not.toBe('');
  });

  it('holds the same frame when there is no photo on file', async () => {
    entry = { ...base, photo_url: '' };
    render(<ContestantProfilePage />);

    // The placeholder is a box, not an img: there is no source to show.
    expect(screen.queryByRole('img')).toBeNull();
    const empty = await screen.findByTestId('contestant-photo-empty');
    expect([Number(empty.style.width.replace(/[^0-9.]/g, '')), Number(empty.style.height.replace(/[^0-9.]/g, ''))])
      .toEqual([240, 320]);
    expect(screen.getByText('📸')).toBeInTheDocument();
  });

  it('still keys the picture off the record, so a name change re-labels it', async () => {
    entry = { ...base, photo_url: SIGNED_BUCKET_URL };
    render(<ContestantProfilePage />);

    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('alt', 'hello new');
    expect(frame(img).fit).toBe('contain');
  });

  it('asks the web plane for the bytes, which can see both upload stores', async () => {
    entry = { ...base, photo_url: SIGNED_BUCKET_URL };
    render(<ContestantProfilePage />);

    const img = await screen.findByRole('img', { name: 'hello new' });
    expect(img).toHaveAttribute(
      'src',
      `/api/web-proxy/api/admin/voting/contestants/${CONTESTANT_ID}/photo`,
    );
    // The roster's presigned URL is the thing that 404s, so it must not survive
    // into the tag even as a fallback attribute.
    expect(img.getAttribute('src')).not.toContain('cloudflarestorage');
  });

  it('swaps to the placeholder when the photo cannot be served', async () => {
    entry = { ...base, photo_url: SIGNED_BUCKET_URL };
    render(<ContestantProfilePage />);

    const img = await screen.findByRole('img', { name: 'hello new' });
    fireEvent.error(img);

    expect(screen.queryByRole('img', { name: 'hello new' })).not.toBeInTheDocument();
    expect(screen.getByText('📸')).toBeInTheDocument();
  });
});
