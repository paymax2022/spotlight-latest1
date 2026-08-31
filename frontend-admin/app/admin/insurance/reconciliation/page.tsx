'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getReconciliation, formatNaira } from '@/services/insuranceAdminService';
import type { ReconciliationDrift, ReconciliationReport } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Badge,
  MetricTile,
  NotReported,
  DisclosureNote,
  LiveState,
  toFailure,
  type EndpointFailure,
  btn,
  th,
  td,
  label,
  select,
  fmtDate,
  timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

const KINDS = ['all', 'missing_locally', 'missing_at_provider', 'status_mismatch', 'premium_mismatch'];

const KIND_LABEL: Record<string, string> = {
  missing_locally: 'Provider has it, we do not',
  missing_at_provider: 'We have it, provider does not',
  status_mismatch: 'Status differs',
  premium_mismatch: 'Premium differs',
};

const KIND_MEANING: Record<string, string> = {
  missing_locally:
    'A policy exists at MyCover that we have no record of. The customer is covered but we cannot service, renew or claim on it, and no commission is recognised for it.',
  missing_at_provider:
    'We recorded a policy the provider does not list. Either the bind never completed at their end, or their record was removed. The customer may believe they are covered when they are not.',
  status_mismatch:
    'Both sides hold the policy but disagree on its state — e.g. we show active, they show lapsed. Whichever is wrong, one of the two is being acted on incorrectly.',
  premium_mismatch:
    'Both sides hold the policy but disagree on the money. This is a settlement difference and is the class of drift that costs real naira.',
};

/**
 * Reconciliation — our policy records against MyCover's `GET /policies`.
 *
 * Drift is reported PER RECORD with a plain-English statement of what that kind
 * of drift means operationally, because "premium_mismatch: 3" tells an operator
 * nothing about whether a customer is uninsured or we are under-paid.
 *
 * A clean report and an unrun report are rendered very differently. "0 drifts"
 * from a comparison that ran is reassuring; "0 drifts" because the comparison
 * has never run is not, and collapsing the two into the same green screen would
 * be the whole failure mode this console was rebuilt to avoid.
 */
export default function InsuranceReconciliationPage() {
  const [data, setData] = useState<ReconciliationReport | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setData(await getReconciliation());
    } catch (e) {
      setData(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const drifts = useMemo(() => data?.drifts ?? [], [data]);
  const rows = useMemo(() => (kind === 'all' ? drifts : drifts.filter((d) => d.kind === kind)), [drifts, kind]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of drifts) m[d.kind] = (m[d.kind] ?? 0) + 1;
    return m;
  }, [drifts]);

  const neverRan = !!data && !data.ran_at;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reconciliation"
        subtitle="Our policy records compared against MyCover's own policy list, and every difference between them."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="reconciliation" />

      <DisclosureNote>
        The provider&rsquo;s record is authoritative for whether cover exists. Ours is authoritative for what
        we owe and what we are owed. Where the two disagree, a customer is either uninsured or
        unbilled — every row below is a person, not a statistic.
      </DisclosureNote>

      <Card
        title="Comparison"
        right={
          data?.ran_at ? (
            <span style={{ fontSize: '0.75rem', color: colors.muted }}>ran {timeAgo(data.ran_at)} · {fmtDate(data.ran_at)}</span>
          ) : null
        }
      >
        <LiveState loading={loading} failure={failure} empty={false} onRetry={load}>
          {data && (
            <>
              {neverRan ? (
                <div
                  style={{
                    border: `1px dashed ${colors.warning}`,
                    borderRadius: '0.5rem',
                    padding: '0.75rem 0.9rem',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    lineHeight: 1.5,
                  }}
                >
                  <strong>No comparison timestamp was reported.</strong> Treat the counts below as
                  &ldquo;not yet compared&rdquo; rather than &ldquo;compared and clean&rdquo;. A reconciliation
                  that has never run and one that ran and found nothing look identical in a count, and only
                  one of them is good news.
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
                <MetricTile
                  label="Our policies"
                  value={data.local_policy_count === null || data.local_policy_count === undefined ? null : data.local_policy_count.toLocaleString('en-NG')}
                  sub="Rows in our database"
                />
                <MetricTile
                  label="At MyCover"
                  value={data.provider_policy_count === null || data.provider_policy_count === undefined ? null : data.provider_policy_count.toLocaleString('en-NG')}
                  sub="Reported by the provider"
                />
                <MetricTile
                  label="Matched"
                  value={data.matched_count === null || data.matched_count === undefined ? null : data.matched_count.toLocaleString('en-NG')}
                  accent={colors.success}
                />
                <MetricTile
                  label="Drifts"
                  value={drifts.length.toLocaleString('en-NG')}
                  sub={neverRan ? 'from a comparison with no timestamp' : 'differences found'}
                  accent={drifts.length ? colors.danger : colors.success}
                />
                <MetricTile
                  label="Money at stake"
                  value={data.total_delta_kobo === null || data.total_delta_kobo === undefined ? null : formatNaira(data.total_delta_kobo)}
                  sub="Absolute premium difference"
                  accent={data.total_delta_kobo ? colors.danger : undefined}
                />
              </div>

              {Object.keys(counts).length > 0 ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                  {Object.entries(counts).map(([k, c]) => (
                    <span
                      key={k}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: 9999,
                        background: colors.headBg,
                        color: colors.text,
                        fontWeight: 600,
                      }}
                    >
                      {KIND_LABEL[k] ?? k}: {c}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </LiveState>
      </Card>

      <Card title="Float vs bound policies">
        <p style={{ fontSize: '0.82rem', color: colors.text, marginTop: 0, lineHeight: 1.55 }}>
          MyCover debits our prefunded wallet on every bind, so the float is a second, independent record of
          what we sold. Comparing it against our own bound premium catches binds the provider charged us for
          and we never recorded, and binds we recorded that were never charged — both are money, and neither
          shows up in a policy-to-policy comparison.
        </p>
        <LiveState loading={loading} failure={failure} empty={false} onRetry={load}>
          {data && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
                <MetricTile
                  label="Float balance"
                  value={data.float_balance_kobo === null || data.float_balance_kobo === undefined ? null : formatNaira(data.float_balance_kobo)}
                  sub="Prefunded with MyCover"
                  accent={data.float_balance_kobo === 0 ? colors.danger : undefined}
                />
                <MetricTile
                  label="Float debited"
                  value={data.float_debited_kobo === null || data.float_debited_kobo === undefined ? null : formatNaira(data.float_debited_kobo)}
                  sub="Charged by the provider"
                />
                <MetricTile
                  label="We bound"
                  value={data.bound_premium_kobo === null || data.bound_premium_kobo === undefined ? null : formatNaira(data.bound_premium_kobo)}
                  sub={
                    data.bound_policy_count === null || data.bound_policy_count === undefined
                      ? 'across our own records'
                      : `across ${data.bound_policy_count.toLocaleString('en-NG')} policies`
                  }
                />
                <MetricTile
                  label="Float drift"
                  value={data.float_delta_kobo === null || data.float_delta_kobo === undefined ? null : formatNaira(data.float_delta_kobo)}
                  sub="Debited minus bound"
                  accent={data.float_delta_kobo ? colors.danger : colors.success}
                />
              </div>
              {data.float_balance_kobo === null || data.float_balance_kobo === undefined ? (
                <p style={{ marginTop: '0.85rem', marginBottom: 0, fontSize: '0.8rem', color: colors.muted, lineHeight: 1.55 }}>
                  The float figures were not reported. MyCover&rsquo;s <code style={{ fontSize: '0.74rem' }}>/wallet/balance</code>{' '}
                  returns 403 for our API key, so this comparison may not be machine-readable until the account
                  scope changes — read the balance from the MyCover dashboard in the meantime. Nothing is shown
                  as zero on its behalf.
                </p>
              ) : null}
            </>
          )}
        </LiveState>
      </Card>

      <Card
        title="Differences"
        right={
          <div style={{ minWidth: 220 }}>
            <label style={label()}>Kind</label>
            <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{k === 'all' ? 'All kinds' : KIND_LABEL[k] ?? k}</option>
              ))}
            </select>
          </div>
        }
      >
        <LiveState
          loading={loading}
          failure={failure}
          empty={rows.length === 0}
          emptyTitle={drifts.length === 0 ? (neverRan ? 'Nothing compared yet' : 'No differences found') : 'No differences of this kind'}
          emptyNote={
            drifts.length === 0
              ? neverRan
                ? 'The endpoint returned no drifts and no run timestamp, so this is an absence of a comparison rather than a clean bill of health.'
                : 'Every policy we hold matches the provider’s record. With no policies sold, a clean comparison is expected.'
              : 'Choose another kind, or clear the filter.'
          }
          onRetry={load}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Kind</th>
                  <th style={th()}>Policy</th>
                  <th style={th()}>Ours</th>
                  <th style={th()}>Provider&rsquo;s</th>
                  <th style={th()}>Delta</th>
                  <th style={th()}>Detected</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <DriftRow key={d.id} d={d} />
                ))}
              </tbody>
            </table>
          </div>
        </LiveState>
      </Card>
    </div>
  );
}

function DriftRow({ d }: { d: ReconciliationDrift }) {
  const money = (v: number | null | undefined) => (v === null || v === undefined ? <NotReported /> : formatNaira(v));
  return (
    <tr>
      <td style={td()}>
        <Badge status={d.kind === 'missing_locally' || d.kind === 'missing_at_provider' ? 'unmatched' : 'break'} label={KIND_LABEL[d.kind] ?? d.kind} />
        <div style={{ fontSize: '0.7rem', color: colors.muted, marginTop: 3, maxWidth: 320, lineHeight: 1.4 }}>
          {KIND_MEANING[d.kind] ?? d.detail ?? ''}
        </div>
      </td>
      <td style={td()}>
        {d.policy_id ? (
          <Link href={`/admin/insurance/policies/${encodeURIComponent(d.policy_id)}`} style={{ color: colors.primary, textDecoration: 'none' }}>
            <code style={{ fontSize: '0.76rem' }}>{d.policy_id}</code>
          </Link>
        ) : (
          <span style={{ color: colors.muted, fontSize: '0.78rem' }}>no local record</span>
        )}
        {d.provider_policy_ref ? (
          <div style={{ fontSize: '0.68rem', color: colors.muted }}>provider: {d.provider_policy_ref}</div>
        ) : null}
        {d.product_code ? <div style={{ fontSize: '0.68rem', color: colors.muted }}><code>{d.product_code}</code></div> : null}
      </td>
      <td style={td()}>
        <div>{d.local_status ? <Badge status={d.local_status} /> : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}</div>
        <div style={{ fontSize: '0.78rem', marginTop: 3 }}>{money(d.local_premium_kobo)}</div>
      </td>
      <td style={td()}>
        <div>{d.provider_status ? <Badge status={d.provider_status} /> : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}</div>
        <div style={{ fontSize: '0.78rem', marginTop: 3 }}>{money(d.provider_premium_kobo)}</div>
      </td>
      <td style={{ ...td(), fontWeight: 700, color: d.delta_kobo ? colors.danger : colors.text }}>{money(d.delta_kobo)}</td>
      <td style={td()}>{d.detected_at ? fmtDate(d.detected_at) : '—'}</td>
    </tr>
  );
}
