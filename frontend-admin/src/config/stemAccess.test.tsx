import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// AUTH-020 follow-up (ADR-056/057): stemAccess.ts used to derive the
// "current" STEM role from a build-time env var. useStemRoles() now fetches
// the signed-in admin's REAL role(s) from the backend (getMyStemRoles) and
// caches the result module-wide. getMyStemRoles is mocked here so these
// tests exercise the caching/fallback behavior without a network call.
const getMyStemRoles = vi.fn();
vi.mock('@/services/stemService', () => ({
  getMyStemRoles: (...args: unknown[]) => getMyStemRoles(...args),
}));

beforeEach(() => {
  vi.resetModules();
  getMyStemRoles.mockReset();
  delete process.env.NEXT_PUBLIC_STEM_ROLE;
});

describe('canReadStem / canManageStem', () => {
  it('accept a single role string (legacy call shape)', async () => {
    const { canReadStem, canManageStem } = await import('./stemAccess');
    expect(canReadStem('JUDGE')).toBe(true);
    expect(canManageStem('JUDGE')).toBe(false);
    expect(canManageStem('CONTEST_MANAGER')).toBe(true);
  });

  it('accept a role array and return true if ANY role qualifies', async () => {
    const { canReadStem, canManageStem } = await import('./stemAccess');
    expect(canReadStem(['REGISTERED_USER', 'JUDGE'])).toBe(true);
    expect(canManageStem(['JUDGE'])).toBe(false);
    expect(canManageStem(['JUDGE', 'CONTEST_MANAGER'])).toBe(true);
  });

  it('return false for an empty role array — no STEM access', async () => {
    const { canReadStem, canManageStem } = await import('./stemAccess');
    expect(canReadStem([])).toBe(false);
    expect(canManageStem([])).toBe(false);
  });
});

describe('useStemRoles', () => {
  it('starts from the env-var fallback and updates once the real fetch resolves', async () => {
    getMyStemRoles.mockResolvedValue(['JUDGE']);
    const { useStemRoles } = await import('./stemAccess');
    const { result } = renderHook(() => useStemRoles());

    expect(result.current).toEqual(['ADMIN']);
    await waitFor(() => expect(result.current).toEqual(['JUDGE']));
    expect(getMyStemRoles).toHaveBeenCalledTimes(1);
  });

  it('shares one fetch across multiple components mounted the same page load', async () => {
    getMyStemRoles.mockResolvedValue(['CONTEST_MANAGER']);
    const { useStemRoles } = await import('./stemAccess');
    const a = renderHook(() => useStemRoles());
    const b = renderHook(() => useStemRoles());

    await waitFor(() => expect(a.result.current).toEqual(['CONTEST_MANAGER']));
    await waitFor(() => expect(b.result.current).toEqual(['CONTEST_MANAGER']));
    expect(getMyStemRoles).toHaveBeenCalledTimes(1);
  });

  it('a later mount reads the already-cached result without a second fetch', async () => {
    getMyStemRoles.mockResolvedValue(['MENTOR']);
    const { useStemRoles } = await import('./stemAccess');
    const first = renderHook(() => useStemRoles());
    await waitFor(() => expect(first.result.current).toEqual(['MENTOR']));

    const second = renderHook(() => useStemRoles());
    expect(second.result.current).toEqual(['MENTOR']);
    expect(getMyStemRoles).toHaveBeenCalledTimes(1);
  });

  it('keeps the fallback when the fetch fails (returns null)', async () => {
    getMyStemRoles.mockResolvedValue(null);
    const { useStemRoles } = await import('./stemAccess');
    const { result } = renderHook(() => useStemRoles());

    await waitFor(() => expect(getMyStemRoles).toHaveBeenCalledTimes(1));
    // Give the resolved (null) promise a tick to be handled, then confirm
    // the fallback was never replaced with nothing/undefined.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual(['ADMIN']);
  });

  it('an empty real roles array (no STEM access) overrides the fallback', async () => {
    getMyStemRoles.mockResolvedValue([]);
    const { useStemRoles } = await import('./stemAccess');
    const { result } = renderHook(() => useStemRoles());

    await waitFor(() => expect(result.current).toEqual([]));
  });
});
