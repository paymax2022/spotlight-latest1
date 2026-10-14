'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AdminUsersRequestError } from '@/services/usersService';
import {
  getReferral360,
  getReferralLedger,
  getUserReferralCode,
  type Referral360,
  type ReferralCode,
  type ReferralLedgerEntry,
} from '@/services/userReferralActivityService';
import { formatKobo } from '@/services/transactionsAdminService';
import { Card, Button, colors } from '@/components/ui/vuexy';

type Section<T> = { data: T | null; loading: boolean; error: string | null; forbidden: boolean; reload: () => void };

/**
 * One independently loading section. Each load takes a ticket; a response that is no
 * longer the latest (the user changed, or Retry was pressed) is dropped in both the
 * success and the failure path.
 */
function useSection<T>(userId: string, fetcher: (id: string) => Promise<T>, failure: string): Section<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const myId = ++requestId.current;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setData(null);
    try {
      const v = await fetcher(userId);
      if (myId !== requestId.current) return;
      setData(v);
    } catch (err) {
      if (myId !== requestId.current) return;
      if (err instanceof AdminUsersRequestError && err.status === 403) setForbidden(true);
      else setError(err instanceof Error ? err.message : failure);
    } finally {
      if (myId === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, forbidden, reload: () => void load() };
}

function SectionBody<T>({ s, what, children }: { s: Section<T>; what: string; children: (d: T) => ReactNode }) {
  if (s.loading) return <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>Loading {what}…</p>;
  if (s.forbidden) return <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>You don&apos;t have permission to view this.</p>;
  if (s.error || s.data === null) {
    return (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{s.error ?? 'No data.'}</p>
        <Button variant="outline" sm onClick={s.reload}>Retry</Button>
      </div>
    );
  }
  return <>{children(s.data)}</>;
}

const heading = { margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: colors.text } as const;

function CodeSection({ userId }: { userId: string }) {
  // The service maps 404 to null, so `data === null` here means "failed"; wrap the null.
  const s = useSection<{ v: ReferralCode | null }>(userId, async (id) => ({ v: await getUserReferralCode(id) }), 'Loading referral code failed.');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <h3 style={heading}>Referral code</h3>
      <SectionBody s={s} what="referral code">
        {({ v }) =>
          v ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
              <code data-testid="referral-code" style={{ fontWeight: 700, fontSize: 15 }}>{v.code}</code>
              <span data-testid="referral-code-source" style={{ color: colors.muted }}>source: {v.source}</span>
              <Button variant="outline" sm onClick={() => void copy(v.code)}>Copy</Button>
              {copied ? <span style={{ color: colors.success }}>Copied</span> : null}
            </div>
          ) : (
            <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No referral code yet</p>
          )
        }
      </SectionBody>
    </div>
  );
}

function Figure({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div style={{ color: colors.muted, fontSize: 12 }}>{label}</div>
      <div data-testid={testId} style={{ fontWeight: 600, fontSize: 14 }}>{value}</div>
    </div>
  );
}

function SummarySection({ userId }: { userId: string }) {
  const s = useSection<Referral360>(userId, getReferral360, 'Loading referral summary failed.');
  return (
    <div>
      <h3 style={heading}>Referral summary</h3>
      <SectionBody s={s} what="referral summary">
        {(d) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <Figure label="People referred" value={String(d.referred_count)} />
            <Figure label="Total earned" value={formatKobo(d.total_earned_kobo)} />
            <Figure label="Paid" value={formatKobo(d.paid_kobo)} />
            <Figure label="Clawed back" value={formatKobo(d.clawed_back_kobo)} />
            <Figure label="Fraud standing" value={d.fraud_standing || 'unknown'} testId="fraud-standing" />
          </div>
        )}
      </SectionBody>
    </div>
  );
}

function LedgerSection({ userId }: { userId: string }) {
  const s = useSection<ReferralLedgerEntry[]>(userId, getReferralLedger, 'Loading referral ledger failed.');
  return (
    <div>
      <h3 style={heading}>Referral ledger <span style={{ color: colors.muted, fontWeight: 400 }}>(most recent 200)</span></h3>
      <SectionBody s={s} what="referral ledger">
        {(rows) =>
          rows.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No referral ledger entries</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted }}>
                    <th>Kind</th><th>State</th><th>Amount</th><th>Currency</th><th>Referred user</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id || `row-${i}`}>
                      <td>{r.kind}</td>
                      <td>{r.state}</td>
                      <td>{formatKobo(r.amount_kobo)}</td>
                      <td>{r.currency}</td>
                      <td>{r.referred_user_id ? String(r.referred_user_id).slice(0, 8) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </SectionBody>
    </div>
  );
}

/**
 * Read-only referral activity for the admin user profile: the user's own code, the
 * referral-360 summary and the referral ledger. Each section loads and fails on its
 * own. No mutation controls.
 */
export function ReferralActivityPanel({ userId }: { userId: string }) {
  return (
    <div data-testid="referral-activity-panel">
      <Card title="Referral activity">
        <div style={{ display: 'grid', gap: 18, marginTop: 8 }}>
          <CodeSection userId={userId} />
          <SummarySection userId={userId} />
          <LedgerSection userId={userId} />
        </div>
      </Card>
    </div>
  );
}
