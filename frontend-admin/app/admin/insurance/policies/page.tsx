'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listPolicies, formatNaira } from '@/services/insuranceAdminService';
import type { Paged, PolicySummary } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Badge,
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
  input,
  fmtDate,
  Pager,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['all', 'pending', 'active', 'expired', 'lapsed', 'cancelled'];
const PAGE_SIZE = 25;

/**
 * Policy register.
 *
 * Filters and paging are pushed to the SERVER (they are query params on
 * /policies), because unlike the catalog this list is unbounded. That means the
 * page must never claim a total it was not given: when the API omits `total`,
 * the footer says "page N" and offers Next only if the API said there is more.
 * Guessing a total from a page length is how pagination silently loses rows.
 */
export default function InsurancePoliciesPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<PolicySummary> | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [productCode, setProductCode] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setData(
        await listPolicies({
          status: status === 'all' ? undefined : status,
          q: q.trim() || undefined,
          product_code: productCode.trim() || undefined,
          page,
          page_size: PAGE_SIZE,
        }),
      );
    } catch (e) {
      setData(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, [status, q, productCode, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change resets to page 1 — paging into page 4 of a filter that
  // only has one page is a confusing empty screen.
  function onFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  const rows = data?.items ?? [];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Policies"
        subtitle="Every policy Paymax has bound, with the underwriter carrying it and the premium collected. Read live from /api/insurance/admin/policies."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="policies" />

      <DisclosureNote>
        Premium shown here is the customer&rsquo;s payment to the underwriter, held as a pass-through
        liability. Only the commission column is Paymax revenue.
      </DisclosureNote>

      <Card
        title="Policy register"
        right={
          <span style={{ fontSize: '0.75rem', color: colors.muted }}>
            {data?.total !== null && data?.total !== undefined
              ? `${data.total.toLocaleString('en-NG')} total`
              : rows.length > 0
                ? 'total not reported by the API'
                : null}
          </span>
        }
      >
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <div style={{ minWidth: 150 }}>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => onFilter(setStatus)(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={label()}>Product code</label>
            <input style={input()} placeholder="e.g. sti-git-annual" value={productCode} onChange={(e) => onFilter(setProductCode)(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={label()}>Search</label>
            <input style={input()} placeholder="Policy ref or provider ref…" value={q} onChange={(e) => onFilter(setQ)(e.target.value)} />
          </div>
        </div>

        <LiveState
          loading={loading}
          failure={failure}
          empty={rows.length === 0}
          emptyTitle={page > 1 ? 'No policies on this page' : 'No policies yet'}
          emptyNote={
            page > 1
              ? 'Go back a page — this filter has fewer results than the page you are on.'
              : 'Nothing has been sold through the insurance module so far. This is an accurate empty register, not a failed load: when a policy is bound it will appear here immediately.'
          }
          onRetry={load}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Reference</th>
                  <th style={th()}>Product</th>
                  <th style={th()}>Underwriter</th>
                  <th style={th()}>Policyholder</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Premium</th>
                  <th style={th()}>Sum insured</th>
                  <th style={th()}>Our commission</th>
                  <th style={th()}>Cover</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={td()}>
                      <Link href={`/admin/insurance/policies/${encodeURIComponent(p.id)}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                        <code style={{ fontSize: '0.78rem' }}>{p.policy_ref || p.id}</code>
                      </Link>
                      {p.provider_policy_ref ? (
                        <div style={{ fontSize: '0.68rem', color: colors.muted }}>provider: {p.provider_policy_ref}</div>
                      ) : null}
                    </td>
                    <td style={td()}>
                      {p.product_name || p.product_code}
                      <div style={{ fontSize: '0.68rem', color: colors.muted }}><code>{p.product_code}</code></div>
                    </td>
                    <td style={td()}>{p.underwriter || <NotReported />}</td>
                    <td style={td()}>{p.policyholder_masked || <NotReported hint="PII is masked by the API." />}</td>
                    <td style={td()}><Badge status={p.status} /></td>
                    <td style={td()}>{p.premium_kobo === null || p.premium_kobo === undefined ? <NotReported /> : formatNaira(p.premium_kobo)}</td>
                    <td style={td()}>{p.sum_insured_kobo === null || p.sum_insured_kobo === undefined ? <NotReported /> : formatNaira(p.sum_insured_kobo)}</td>
                    <td style={{ ...td(), color: colors.success, fontWeight: 600 }}>
                      {p.commission_kobo === null || p.commission_kobo === undefined ? <NotReported /> : formatNaira(p.commission_kobo)}
                    </td>
                    <td style={td()}>
                      {p.starts_at || p.ends_at ? (
                        <span style={{ fontSize: '0.78rem' }}>{fmtDate(p.starts_at)} → {fmtDate(p.ends_at)}</span>
                      ) : (
                        <NotReported />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager page={page} hasMore={data?.has_more ?? false} onChange={setPage} count={rows.length} total={data?.total ?? null} />
        </LiveState>
      </Card>
    </div>
  );
}
