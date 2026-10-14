'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminUsersRequestError } from '@/services/usersService';
import { getUserTier } from '@/services/userFinanceService';
import { getUserReferralCase, type ReferralCase } from '@/services/userReferralService';
import { Card, Button, colors } from '@/components/ui/vuexy';

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

/** Amounts are integer kobo; divide for display only. */
function formatKobo(kobo: number): string {
  return naira.format(kobo / 100);
}

type TierInfo = { tier: number; dailyDebitLimitKobo: number; maxBalanceKobo: number };

type Sub<T> = { loading: boolean; data: T | null; error: string | null; forbidden: boolean };
const initial = <T,>(): Sub<T> => ({ loading: true, data: null, error: null, forbidden: false });

/** Runs one sub-read, owning its own loading/error/403 state. */
function useSub<T>(fetcher: () => Promise<T>, fallback: string) {
  const [state, setState] = useState<Sub<T>>(initial<T>());
  const load = useCallback(async () => {
    setState({ loading: true, data: null, error: null, forbidden: false });
    try {
      setState({ loading: false, data: await fetcher(), error: null, forbidden: false });
    } catch (err) {
      if (err instanceof AdminUsersRequestError && err.status === 403) {
        setState({ loading: false, data: null, error: null, forbidden: true });
      } else {
        setState({ loading: false, data: null, error: err instanceof Error ? err.message : fallback, forbidden: false });
      }
    }
  }, [fetcher, fallback]);
  useEffect(() => {
    void load();
  }, [load]);
  return { state, load };
}

function SubBody<T>({
  sub,
  loadingLabel,
  children,
}: {
  sub: { state: Sub<T>; load: () => Promise<void> };
  loadingLabel: string;
  children: (data: T) => React.ReactNode;
}) {
  const { state, load } = sub;
  if (state.loading) return <p style={{ color: colors.muted, fontSize: 13 }}>{loadingLabel}</p>;
  if (state.forbidden) return <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  if (state.error || state.data === null) {
    return (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{state.error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  return <>{children(state.data)}</>;
}

function limitsLabel(t: TierInfo): string {
  if (t.tier === 0) return 'Wallet disabled';
  if (t.tier === 3) return 'Unlimited';
  return `${formatKobo(t.dailyDebitLimitKobo)}/day debit · ${formatKobo(t.maxBalanceKobo)} max balance`;
}

const heading = { fontSize: 13, fontWeight: 600, color: colors.text, margin: '0 0 6px' } as const;
const muted = { color: colors.muted, fontSize: 13, margin: 0 } as const;

/**
 * Read-only account tier & referral summary for the admin user profile. Each
 * subsection is an independent read with its own loading/error/403 state.
 * Contains no mutation controls.
 */
export function ReferralTierPanel({ userId }: { userId: string }) {
  const tierFetch = useCallback(() => getUserTier(userId), [userId]);
  const refFetch = useCallback(() => getUserReferralCase(userId), [userId]);
  const tierSub = useSub<TierInfo>(tierFetch, 'Loading account tier failed.');
  const refSub = useSub<ReferralCase>(refFetch, 'Loading referral summary failed.');

  return (
    <div data-testid="referral-tier-panel">
      <Card title="Referrals / Tier">
        <div style={{ marginTop: 8, display: 'grid', gap: 16 }}>
          <section>
            <h4 style={heading}>Account tier &amp; limits</h4>
            <SubBody sub={tierSub} loadingLabel="Loading account tier…">
              {(t) => (
                <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                  <div style={{ color: colors.muted }}>
                    Tier <strong data-testid="tier-number" style={{ color: colors.text }}>{t.tier}</strong>
                  </div>
                  <div data-testid="tier-limits">{limitsLabel(t)}</div>
                </div>
              )}
            </SubBody>
          </section>

          <section>
            <h4 style={heading}>Referrals</h4>
            <SubBody sub={refSub} loadingLabel="Loading referrals…">
              {(c) => {
                const sum = c.rewards.reduce((acc, r) => acc + r.reward_kobo, 0);
                return (
                  <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                    {c.tier ? (
                      <div>
                        Referral tier <strong data-testid="referral-tier-name">{c.tier.current_tier}</strong>
                        {' · '}Active referrals <strong data-testid="referral-active-count">{c.tier.active_referral_count}</strong>
                        {' · '}Rate <strong data-testid="referral-rate">{`${+(c.tier.current_rate * 100).toFixed(2)}%`}</strong>
                      </div>
                    ) : (
                      <p style={muted}>No referral tier yet</p>
                    )}
                    {c.rewards.length === 0 ? (
                      <p style={muted}>No rewards yet</p>
                    ) : (
                      <div>
                        Rewards earned <strong data-testid="referral-rewards-count">{c.rewards.length}</strong>
                        {' · '}Total <strong data-testid="referral-rewards-sum">{formatKobo(sum)}</strong>
                      </div>
                    )}
                    {c.milestones.length === 0 ? (
                      <p style={muted}>No milestones yet</p>
                    ) : (
                      <ul data-testid="referral-milestones" style={{ margin: 0, paddingLeft: 18 }}>
                        {c.milestones.map((m) => (
                          <li key={m.id}>
                            {m.threshold} referrals · {formatKobo(m.bonus_kobo)} · {m.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              }}
            </SubBody>
          </section>
        </div>
      </Card>
    </div>
  );
}
