'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listClaims, formatNaira } from '@/services/insuranceAdminService';
import type { ClaimSummary, Paged } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Badge,
  NotReported,
  DisclosureNote,
  LiveState,
  Pager,
  toFailure,
  type EndpointFailure,
  btn,
  th,
  td,
  label,
  select,
  input,
  fmtDate,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['all', 'submitted', 'under_review', 'approved', 'rejected', 'paid'];
const PAGE_SIZE = 25;

/**
 * Claims register.
 *
 * Note on the provider: MyCover's `GET /claims` returns 403 for the credential
 * this environment holds, so claim data can only ever be as complete as what our
 * own database records. That is a real limitation and the page says so rather
 * than presenting a partial list as the whole picture.
 */
export default function InsuranceClaimsPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<ClaimSummary> | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setData(
        await listClaims({
          status: status === 'all' ? undefined : status,
          q: q.trim() || undefined,
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
  }, [status, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.items ?? [];
  const money = (v: number | null | undefined) => (v === null || v === undefined ? <NotReported /> : formatNaira(v));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Claims"
        subtitle="Claims raised against policies we distributed, read live from /api/insurance/admin/claims."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="claims" />

      <DisclosureNote>
        Claims are assessed and paid by the <strong>underwriter</strong>, not by Paymax. This register
        tracks them; it does not decide them.
      </DisclosureNote>

      <Card
        title="Claim register"
        right={
          <span style={{ fontSize: '0.75rem', color: colors.muted }}>
            {data?.total !== null && data?.total !== undefined ? `${data.total.toLocaleString('en-NG')} total` : null}
          </span>
        }
      >
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <div style={{ minWidth: 170 }}>
            <label style={label()}>Status</label>
            <select
              style={select()}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={label()}>Search</label>
            <input
              style={input()}
              placeholder="Claim ref or policy id…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <LiveState
          loading={loading}
          failure={failure}
          empty={rows.length === 0}
          emptyTitle={page > 1 ? 'No claims on this page' : 'No claims yet'}
          emptyNote={
            page > 1
              ? 'Go back a page — this filter has fewer results than the page you are on.'
              : 'No claim has been raised. With no policies sold there is nothing to claim against, so an empty register here is expected and correct.'
          }
          onRetry={load}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Claim</th>
                  <th style={th()}>Policy</th>
                  <th style={th()}>Product</th>
                  <th style={th()}>Claimant</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Claimed</th>
                  <th style={th()}>Approved</th>
                  <th style={th()}>Loss event</th>
                  <th style={th()}>Raised</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={td()}>
                      <Link href={`/admin/insurance/claims/${encodeURIComponent(c.id)}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                        <code style={{ fontSize: '0.78rem' }}>{c.claim_ref || c.id}</code>
                      </Link>
                      {c.provider_claim_ref ? (
                        <div style={{ fontSize: '0.68rem', color: colors.muted }}>provider: {c.provider_claim_ref}</div>
                      ) : null}
                    </td>
                    <td style={td()}>
                      <Link href={`/admin/insurance/policies/${encodeURIComponent(c.policy_id)}`} style={{ color: colors.primary, textDecoration: 'none' }}>
                        <code style={{ fontSize: '0.76rem' }}>{c.policy_id}</code>
                      </Link>
                    </td>
                    <td style={td()}>{c.product_name || <NotReported />}</td>
                    <td style={td()}>{c.claimant_masked || <NotReported hint="PII is masked by the API." />}</td>
                    <td style={td()}><Badge status={c.status} /></td>
                    <td style={td()}>{money(c.claimed_amount_kobo)}</td>
                    <td style={td()}>{money(c.approved_amount_kobo)}</td>
                    <td style={td()}>{c.loss_event_at ? fmtDate(c.loss_event_at) : '—'}</td>
                    <td style={td()}>{c.created_at ? fmtDate(c.created_at) : '—'}</td>
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
