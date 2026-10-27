/**
 * Estate lifecycle write gate (ESTD-D025 / EST-UAT-0418,0419).
 *
 * Mirrors the Go LifecycleGate on /api/finance/estate/:id: a mutating estate
 * action is refused with 423 while the estate is pending/suspended/closed,
 * reads are unaffected, and membership is still resolved first (a non-member
 * gets the plain null → 403 without learning the estate's status).
 */
import { describe, it, expect } from 'vitest';

import { getResidentContext, assertEstateWritable } from '@/src/server/estate/resident';
import { getGuardContext } from '@/src/server/visitor/gate.service';
import { ApiError } from '@/src/lib/api/responses';

const RESIDENT = { estate_id: 'est-1', unit: 'A-1', role: 'resident' };
const SESSION = { estate_id: 'est-1', gate_id: 'gate-1', guard_name: 'G' };

function makeSupabase(rows: { resident?: any; estate?: any; session?: any; estateError?: any }) {
  const tables: string[] = [];
  const builder = (table: string) => {
    const chain: any = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'upsert', 'neq']) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = async () => {
      if (table === 'estate_residents') return { data: rows.resident ?? null, error: null };
      if (table === 'gate_sessions') return { data: rows.session ?? null, error: null };
      if (table === 'estates') return { data: rows.estate ?? null, error: rows.estateError ?? null };
      return { data: null, error: null };
    };
    return chain;
  };
  return {
    tables,
    from: (t: string) => {
      tables.push(t);
      return builder(t);
    },
  } as any;
}

describe('getResidentContext lifecycle gate', () => {
  it('read path resolves membership without touching estates', async () => {
    const sb = makeSupabase({ resident: RESIDENT });
    const ctx = await getResidentContext(sb, 'user-1');
    expect(ctx).toEqual({ estateId: 'est-1', unit: 'A-1', role: 'resident' });
    expect(sb.tables).toEqual(['estate_residents']);
  });

  it('forWrite passes on an active estate', async () => {
    const sb = makeSupabase({ resident: RESIDENT, estate: { status: 'active' } });
    const ctx = await getResidentContext(sb, 'user-1', { forWrite: true });
    expect(ctx?.estateId).toBe('est-1');
    expect(sb.tables).toEqual(['estate_residents', 'estates']);
  });

  it.each(['pending', 'suspended', 'closed'])('forWrite throws 423 on a %s estate', async (status) => {
    const sb = makeSupabase({ resident: RESIDENT, estate: { status } });
    const err = await getResidentContext(sb, 'user-1', { forWrite: true }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(423);
    expect((err as Error).message).toContain(status);
  });

  it('non-member gets null without the estates lookup (no status leak)', async () => {
    const sb = makeSupabase({ resident: null, estate: { status: 'suspended' } });
    const ctx = await getResidentContext(sb, 'user-1', { forWrite: true });
    expect(ctx).toBeNull();
    expect(sb.tables).toEqual(['estate_residents']);
  });

  it('estates lookup failure fails closed with 500, never open', async () => {
    const sb = makeSupabase({ resident: RESIDENT, estateError: { message: 'db down' } });
    await expect(getResidentContext(sb, 'user-1', { forWrite: true })).rejects.toMatchObject({ status: 500 });
  });
});

describe('getGuardContext lifecycle gate', () => {
  it('read path resolves the session without touching estates', async () => {
    const sb = makeSupabase({ session: SESSION });
    const ctx = await getGuardContext(sb, 'guard-1');
    expect(ctx).toEqual({ estateId: 'est-1', gateId: 'gate-1', guardName: 'G' });
    expect(sb.tables).toEqual(['gate_sessions']);
  });

  it('forWrite throws 423 on a suspended estate', async () => {
    const sb = makeSupabase({ session: SESSION, estate: { status: 'suspended' } });
    await expect(getGuardContext(sb, 'guard-1', { forWrite: true })).rejects.toMatchObject({ status: 423 });
  });

  it('forWrite passes on an active estate', async () => {
    const sb = makeSupabase({ session: SESSION, estate: { status: 'active' } });
    const ctx = await getGuardContext(sb, 'guard-1', { forWrite: true });
    expect(ctx?.gateId).toBe('gate-1');
  });
});

describe('assertEstateWritable', () => {
  it('passes on active', async () => {
    const sb = makeSupabase({ estate: { status: 'active' } });
    await expect(assertEstateWritable(sb, 'est-1')).resolves.toBeUndefined();
  });

  it('throws 423 on suspended with the status in the message', async () => {
    const sb = makeSupabase({ estate: { status: 'suspended' } });
    await expect(assertEstateWritable(sb, 'est-1')).rejects.toMatchObject({
      status: 423,
      message: expect.stringContaining('suspended'),
    });
  });

  it('a missing estate row is not writable', async () => {
    const sb = makeSupabase({ estate: null });
    await expect(assertEstateWritable(sb, 'est-1')).rejects.toMatchObject({ status: 423 });
  });
});
