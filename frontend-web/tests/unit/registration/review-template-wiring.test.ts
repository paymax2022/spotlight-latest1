/**
 * AD-003/CS-004 — reviewRegistrationApplication's template-bridge wiring
 * (supabase-store.ts, ~line 837 onward).
 *
 * Regression guard: when resolveActiveTemplateForContest() finds a template,
 * processContestantPhoto (full compositing) must be called with the resolved
 * template/slot; when it returns null (the common case — no template
 * configured yet), the flow must fall back to processContestantPhotoNoTemplate
 * exactly as before this change, so the already-working no-template path
 * cannot silently break.
 *
 * Mocks @supabase/supabase-js directly — supabase-store.ts builds its own
 * lazy client via createClient the same way template-resolver.ts does, not
 * through @/lib/supabase/server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const registrationsRow = {
  id: 'app-1',
  reference: 'OPENMI-000001-ABCD',
  contest_slug: 'open-mic-competition',
  status: 'under_review',
  role: 'public_user',
  user_id: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  submitted_at: '2026-01-01T00:00:00Z',
  completion_percent: 100,
  current_step: 'review',
  fraud_flags: [],
  form_data: { 'media.photoUrl': 'https://cdn.test/raw-photo.jpg' },
};

const connectContestRow = { id: 'connect-contest-1' };

function makeChain(table: string) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    single: () => Promise.resolve({ data: registrationsRow, error: null }),
    maybeSingle: () => Promise.resolve({ data: connectContestRow, error: null }),
  };
  if (table === 'registrations') {
    // .update({...}).eq('id', applicationId) — awaited directly with no .select()/.single()
    // in the notes-write step; .then is provided so `await` on the chain itself resolves.
    chain.then = (resolve: any) => resolve({ data: null, error: null });
  }
  return chain;
}

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => makeChain(table),
    rpc: rpcMock,
  })),
}));

vi.mock('@/src/server/registration/photo-pipeline', () => ({
  processContestantPhoto: vi.fn(),
  processContestantPhotoNoTemplate: vi.fn(),
}));

vi.mock('@/src/server/registration/template-resolver', () => ({
  resolveActiveTemplateForContest: vi.fn(),
}));

import { reviewRegistrationApplication } from '@/src/server/registration/supabase-store';
import { processContestantPhoto, processContestantPhotoNoTemplate } from '@/src/server/registration/photo-pipeline';
import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: null, error: null });
  vi.mocked(processContestantPhoto).mockResolvedValue({ status: 'ready', photoUrl: 'https://cdn.test/composited.png' });
  vi.mocked(processContestantPhotoNoTemplate).mockResolvedValue({ status: 'ready', photoUrl: 'https://cdn.test/cutout.png' });
});

describe('AD-003/CS-004: reviewRegistrationApplication template resolution wiring', () => {
  it('calls processContestantPhoto with the resolved template/slot when a template resolves', async () => {
    const slot = {
      id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
      x: 0, y: 0, width: 300, height: 400, rotation: 0, z_index: 1, scale: 1,
      crop_mode: 'cover' as const, border_radius: 0, opacity: 1,
    };
    vi.mocked(resolveActiveTemplateForContest).mockResolvedValue({
      templateUrl: 'https://cdn.test/template.png',
      templateWidth: 1080,
      templateHeight: 1350,
      slot,
    });

    await reviewRegistrationApplication('app-1', { status: 'approved' });

    expect(resolveActiveTemplateForContest).toHaveBeenCalledWith('connect-contest-1');
    expect(processContestantPhoto).toHaveBeenCalledWith({
      rawPhotoUrl: 'https://cdn.test/raw-photo.jpg',
      templateUrl: 'https://cdn.test/template.png',
      templateWidth: 1080,
      templateHeight: 1350,
      slot,
    });
    expect(processContestantPhotoNoTemplate).not.toHaveBeenCalled();
  });

  it('falls back to processContestantPhotoNoTemplate exactly as before when no template resolves', async () => {
    vi.mocked(resolveActiveTemplateForContest).mockResolvedValue(null);

    await reviewRegistrationApplication('app-1', { status: 'approved' });

    expect(processContestantPhotoNoTemplate).toHaveBeenCalledWith('https://cdn.test/raw-photo.jpg');
    expect(processContestantPhoto).not.toHaveBeenCalled();
  });

  it('does not attempt template resolution for a non-promoting status', async () => {
    await reviewRegistrationApplication('app-1', { status: 'rejected' });

    expect(resolveActiveTemplateForContest).not.toHaveBeenCalled();
    expect(processContestantPhoto).not.toHaveBeenCalled();
    expect(processContestantPhotoNoTemplate).not.toHaveBeenCalled();
  });
});
