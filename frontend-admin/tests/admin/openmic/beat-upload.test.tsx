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

// The page calls useRouter() on render, and vitest has no mounted Next app
// router — without this shim every case dies on "invariant expected app router
// to be mounted" before it can reach the beat fields. Same mock as
// src/components/guards/AdminRouteGuard.test.tsx:16. `push` is recorded so a
// future case can assert the post-create redirect.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import NewOpenMicContestPage from '../../../app/admin/open-mic/new/page';

const READER = '/api/open-mic/beats/b3Blbm1pYy1iZWF0cy91bmFzc2lnbmVkL2EubXBz';

beforeEach(() => {
  uploadOpenMicBeat.mockReset();
  createOpenMicContest.mockReset();
});
afterEach(() => cleanup());

function downloadField(): HTMLInputElement {
  return screen.getByLabelText(/Beat file URL \(Download\)/i) as HTMLInputElement;
}

describe('Open Mic beat upload in the admin console', () => {
  it('uploads the picked mp3 and files both reader paths', async () => {
    uploadOpenMicBeat.mockResolvedValue({ previewUrl: READER, downloadUrl: `${READER}?download=1` });
    render(<NewOpenMicContestPage />);
    const file = new File([new Uint8Array([1, 2, 3])], 'beat.mp3', { type: 'audio/mp3' });
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), { target: { files: [file] } });
    await waitFor(() => expect(uploadOpenMicBeat).toHaveBeenCalledTimes(1));
    expect(uploadOpenMicBeat.mock.calls[0][0]).toBe(file);
    await waitFor(() => expect(downloadField().value).toBe(`${READER}?download=1`));
    expect(screen.getByLabelText(/Beat preview URL/i)).toHaveValue(READER);
  });

  it('surfaces the server error instead of leaving the picker looking idle', async () => {
    uploadOpenMicBeat.mockRejectedValue(new Error('Beat upload failed: 400 — Expected an .mp3 file.'));
    render(<NewOpenMicContestPage />);
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), {
      target: { files: [new File([new Uint8Array([1])], 'beat.mp3', { type: 'audio/mp3' })] },
    });
    expect(await screen.findByText(/400 — Expected an \.mp3 file/)).toBeInTheDocument();
  });

  it('warns about a pasted URL an artist cannot open', async () => {
    render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: 'https://cdn.example.com/beat.mp3' } });
    expect(await screen.findByText(/Upload the mp3 instead/i)).toBeInTheDocument();
  });

  it('names a pre-fix registration URL as legacy, not as a URL', async () => {
    render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: '/api/registration/uploads/abc' } });
    expect(await screen.findByText(/before the public-beat fix/i)).toBeInTheDocument();
  });
});
