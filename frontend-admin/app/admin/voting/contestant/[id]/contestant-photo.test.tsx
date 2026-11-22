/**
 * The contestant profile picture in the admin console.
 *
 * The frame was `width: 100%, height: 180, objectFit: 'cover'` inside a
 * half-width card — a landscape letterbox of what is almost always a portrait
 * headshot. `cover` scales the source to fill the box and cuts what does not
 * fit, so a 3:4 photo in a 340×180 slot loses roughly the top third: exactly
 * the part with the face. An operator checking a contestant's identity photo
 * was being shown a crop of it.
 *
 * So the frame is portrait (3:4) and the fit is `contain`, which shows the
 * whole image. `contain` leaves bands above and below a landscape source, so
 * the frame carries a background and a border and reads as a frame rather
 * than as a broken image. The no-photo placeholder uses the same frame: two
 * different boxes for the same slot is how a card jumps as it loads.
 *
 * No assertion here pins the image `src`. On `main` it is still the roster's
 * `photo_url` (a presigned GET for the Go bucket, which 404s NoSuchKey for a
 * registration upload the web app stored locally); switching it to
 * `/api/admin/voting/contestants/:id/photo` through the web proxy is separate
 * in-flight work on `feat/mobile-menu-visibility`, and that branch will collide
 * with this frame at the same `<img>` line — keep its proxy `src` plus
 * `onError`, and this portrait/`contain` style block.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

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
    entry = { ...base, photo_url: 'https://bucket.example/signed?X-Amz-Signature=abc' };
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
    entry = { ...base, photo_url: 'https://bucket.example/signed?X-Amz-Signature=abc' };
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
    entry = { ...base, photo_url: 'https://bucket.example/signed?X-Amz-Signature=abc' };
    render(<ContestantProfilePage />);

    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('alt', 'hello new');
    expect(frame(img).fit).toBe('contain');
  });
});
