import { describe, it, expect } from 'vitest';
import { examWindowBlocker } from '@/src/server/services/academy/assessment/attempts';

const at = (iso: string) => new Date(iso);
const win = { opens_at: '2026-11-01T09:00:00.000Z', closes_at: '2026-11-01T17:00:00.000Z' };

describe('examWindowBlocker', () => {
  it('blocks before the start time', () => {
    const r = examWindowBlocker(win, at('2026-11-01T08:59:59.999Z'));
    expect(r).toMatchObject({ ok: false, code: 'EXAM_NOT_OPEN_YET' });
  });

  it('opens exactly at the start time (inclusive)', () => {
    expect(examWindowBlocker(win, at('2026-11-01T09:00:00.000Z')).ok).toBe(true);
  });

  it('is open inside the window', () => {
    expect(examWindowBlocker(win, at('2026-11-01T12:00:00.000Z')).ok).toBe(true);
  });

  it('closes exactly at the end time (exclusive)', () => {
    const r = examWindowBlocker(win, at('2026-11-01T17:00:00.000Z'));
    expect(r).toMatchObject({ ok: false, code: 'EXAM_CLOSED' });
  });

  it('treats a null bound as unbounded on that side', () => {
    expect(examWindowBlocker({ opens_at: null, closes_at: null }, at('2030-01-01T00:00:00.000Z')).ok).toBe(true);
    expect(examWindowBlocker({ opens_at: null, closes_at: win.closes_at }, at('2020-01-01T00:00:00.000Z')).ok).toBe(true);
    expect(examWindowBlocker({ opens_at: win.opens_at, closes_at: null }, at('2099-01-01T00:00:00.000Z')).ok).toBe(true);
  });
});
