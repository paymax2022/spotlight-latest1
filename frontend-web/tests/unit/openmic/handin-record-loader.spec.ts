// The hand-in loader reads ONE artist's row, and a broken read must not break the
// page.
//
// Both halves are guards on real failure modes. The scoping is the security one:
// `listRegistrationApplications` (the other reader of this table for the same
// question) fetches the whole table and filters in TypeScript, so a hand-in page
// built on it would put a full-table read behind a public route — the precedent for
// a user-scoped read is `submission-eligibility.ts`, and `.eq('user_id', …)` is the
// part of it that must not be lost in a refactor. The fallback is the product one:
// inheritance is a convenience, and an artist whose application read failed must
// still see every question rather than a confirmed value with nothing behind it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const state = { rows: [] as unknown[], failure: null as Error | null, userId: 'user-1' };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  Object.defineProperty(chain, 'then', {
    configurable: true,
    get() {
      return (resolve: (value: unknown) => void) => {
        if (state.failure) resolve({ data: null, error: state.failure });
        else resolve({ data: state.rows, error: null });
      };
    },
  });
  return {
    calls,
    state,
    chain,
    // A mutable holder rather than a Mock instance: the mocked module calls this
    // as a plain function, and the tests replace `entry` per case.
    requireUser: {
      entry: (async () => ({ user: { id: state.userId, email: 'artist@example.com' } })) as (
        ...args: unknown[]
      ) => Promise<{ user: { id: string; email: string } }>,
    },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      harness.calls.push({ method: 'from', args: [table] });
      return harness.chain;
    },
  }),
}));

vi.mock('@/src/lib/auth/server', () => ({
  requireUser: () => harness.requireUser.entry(),
}));

import {
  getHandinInheritance,
  readHandinRecord,
} from '@/src/server/openmic/handin-record';

const USER_ID = 'ed2c401b-44b4-4074-9a1a-756b3e256225';

beforeEach(() => {
  harness.calls.length = 0;
  harness.state.rows = [];
  harness.state.failure = null;
  harness.state.userId = USER_ID;
  harness.requireUser.entry = async () => ({
    user: { id: harness.state.userId, email: 'artist@example.com' },
  });
});

describe('the hand-in read is scoped to one artist', () => {
  it('filters registrations by user_id, not by reading the table', async () => {
    await readHandinRecord('spotlight-open-mic-2026-11');
    expect(harness.calls.map((call) => call.args)).toContainEqual(['user_id', USER_ID]);
    expect(harness.calls.some((call) => call.method === 'in' && call.args[0] === 'contest_slug')).toBe(true);
    expect(callsTable()).toContain('registrations');
  });

  it('names the columns it maps instead of selecting all of them', async () => {
    await readHandinRecord('spotlight-open-mic-2026-11');
    const select = harness.calls.find((call) => call.method === 'select');
    expect(String(select?.args[0])).not.toContain('*');
    expect(String(select?.args[0])).toContain('form_data');
  });

  function callsTable() {
    return String(harness.calls.find((call) => call.method === 'from')?.args[0] ?? '');
  }
});

describe('getHandinInheritance', () => {
  it('maps the stored row onto the answers the form can confirm', async () => {
    harness.state.rows = [{
      contest_slug: 'open-mic-competition',
      updated_at: '2026-11-18T00:00:00.000Z',
      form_data: { 'personal.stateOfResidence': 'Anambra', 'personal.city': 'Awka North' },
    }];
    expect(await getHandinInheritance(USER_ID, 'spotlight-open-mic-2026-11'))
      .toMatchObject({ state: 'Anambra', lga: 'Awka North', source: 'open-mic' });
  });

  it('reports no answers when the row carries none', async () => {
    harness.state.rows = [{
      contest_slug: 'open-mic-competition',
      updated_at: '2026-11-18T00:00:00.000Z',
      form_data: {},
    }];
    expect(await getHandinInheritance(USER_ID, 'open-mic'))
      .toMatchObject({ state: '', lga: '', source: 'open-mic' });
  });

  it('swallows a database error instead of failing the page', async () => {
    harness.state.failure = new Error('relation missing');
    await expect(getHandinInheritance(USER_ID, 'open-mic')).resolves.toMatchObject({ state: '', source: 'none' });
  });

  it('needs no user id and never opens a client without one', async () => {
    await expect(getHandinInheritance('', 'open-mic')).resolves.toMatchObject({ source: 'none' });
    expect(harness.calls.some((call) => call.method === 'from')).toBe(false);
  });
});

describe('readHandinRecord', () => {
  it('degrades to the empty record when the visitor is signed out', async () => {
    harness.requireUser.entry = async () => { throw new Error('UNAUTHORIZED'); };
    await expect(readHandinRecord('open-mic')).resolves.toEqual({
      inheritance: { email: '', state: '', lga: '', instagram: '', tiktok: '', source: 'none' },
      accountEmail: '',
    });
  });

  it('hands the recorded handles to the form', async () => {
    // The loader does not filter answers by key, so a registration that wrote
    // `social.instagram` reaches the screen that decides whether to confirm it.
    harness.state.rows = [{
      contest_slug: 'open-mic-competition',
      updated_at: '2026-11-18T00:00:00.000Z',
      form_data: { 'social.instagram': '@adaforce', 'social.tiktok': '@ada_tk' },
    }];
    const record = await readHandinRecord('open-mic');
    expect(record.inheritance.instagram).toBe('@adaforce');
    expect(record.inheritance.tiktok).toBe('@ada_tk');
  });

  it('separates the entry email from the account email', async () => {
    harness.state.rows = [{
      contest_slug: 'open-mic-competition',
      updated_at: '2026-11-18T00:00:00.000Z',
      form_data: { 'contact.email': 'entry@example.com' },
    }];
    const record = await readHandinRecord('open-mic');
    expect(record.inheritance.email).toBe('entry@example.com');
    expect(record.accountEmail).toBe('artist@example.com');
  });

  it('carries the account email with no application at all', async () => {
    harness.state.rows = [];
    const record = await readHandinRecord('open-mic');
    expect(record.inheritance).toMatchObject({ email: '', source: 'none' });
    expect(record.accountEmail).toBe('artist@example.com');
  });
});
