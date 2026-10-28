'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getReviewDispute, getReviewsSummary, listReviewDisputes, resolveReviewDispute, getReview,
  KIND_LABEL,
  type DisputeDetail, type DisputeKind, type DisputeRecord, type DisputeStatus, type ModerationEvent, type ReviewsSummary,
} from '@/services/telemedAdminReviewsService';
import {
  PageHeader, TelemedTabs, Card, Kpi, Badge, StateBlock, FilterBar, btn, th, td, label, select, timeAgo,
} from '../../_ui';
import { colors } from '@/components/ui/vuexy';
import { ReviewsTabs, Stars, Panel, Field, History, ReasonForm } from '../_parts';

const PAGE = 25;

export default function ReviewDisputesPage() {
  const [summary, setSummary] = useState<ReviewsSummary | null>(null);
  const [rows, setRows] = useState<DisputeRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DisputeStatus | ''>('open');
  const [kind, setKind] = useState<DisputeKind | ''>('');

  const [open, setOpen] = useState<DisputeDetail | null>(null);
  const [history, setHistory] = useState<ModerationEvent[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try { setSummary(await getReviewsSummary()); } catch { setSummary(null); }
  }, []);

  const loadList = useCallback(async (nextOffset: number) => {
    setLoading(true); setError(null);
    try {
      const page = await listReviewDisputes({ status, kind, limit: PAGE, offset: nextOffset });
      setRows(page.rows); setTotal(page.total); setOffset(nextOffset);
    } catch (e) {
      setRows([]); setTotal(0); setError(String((e as Error).message ?? e));
    } finally { setLoading(false); }
  }, [status, kind]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadList(0); }, [loadList]);

  async function load(id: string) {
    const d = await getReviewDispute(id);
    setOpen(d);
    setHistory(d.review ? (await getReview(d.review.source, d.review.id)).history : []);
  }

  async function openDispute(d: DisputeRecord) {
    setOpenError(null); setActionError(null);
    try { await load(d.id); } catch (e) { setOpen(null); setOpenError(String((e as Error).message ?? e)); }
  }

  async function resolve(decision: 'upheld' | 'rejected', reason: string) {
    if (!open) return;
    setBusy(true); setActionError(null);
    try {
      await resolveReviewDispute(open.id, decision, reason);
      await load(open.id);
      await Promise.all([loadList(offset), loadSummary()]);
    } catch (e) {
      setActionError(String((e as Error).message ?? e));
    } finally { setBusy(false); }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.floor(offset / PAGE) + 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Review disputes & reports"
        subtitle="Doctors dispute, report or ask to remove reviews from the doctor app. Upholding a complaint hides the review; rejecting it leaves the review visible. Oldest open items come first."
        action={<button style={btn()} onClick={() => { void loadSummary(); void loadList(offset); }}>Refresh</button>}
      />
      <TelemedTabs active="reviews" />
      <ReviewsTabs active="disputes" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Open" value={summary ? summary.open_disputes.toLocaleString('en-NG') : '…'} accent={summary && summary.open_disputes > 0 ? colors.danger : undefined} />
        <Kpi label="Resolved (30d)" value={summary ? summary.resolved_disputes_30d.toLocaleString('en-NG') : '…'} />
        <Kpi label="Reported reviews" value={summary ? summary.reported_reviews.toLocaleString('en-NG') : '…'} />
      </div>

      {openError ? <p style={{ color: colors.danger }}>{openError}</p> : null}
      {open ? (
        <Panel title={`${KIND_LABEL[open.kind]} — ${open.doctor_name || 'Unknown doctor'}`} onClose={() => { setOpen(null); setActionError(null); }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem 1.5rem' }}>
            <Field name="Status"><Badge status={open.status} /></Field>
            <Field name="Raised">{new Date(open.created_at).toLocaleString('en-NG')}</Field>
          </div>
          <Field name="Doctor's complaint">{open.reason || <span style={{ color: colors.muted }}>No reason given.</span>}</Field>

          <Field name="Disputed review">
            {open.review ? (
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.375rem', padding: '0.6rem', background: colors.bg }}>
                <Stars rating={open.review.rating} /> {open.review.hidden ? <Badge status="rejected" label="Hidden" /> : <Badge status="active" label="Visible" />}
                <div style={{ marginTop: '0.3rem' }}>{open.review.comment || <span style={{ color: colors.muted }}>No written comment.</span>}</div>
              </div>
            ) : (
              <span style={{ color: colors.muted }}>The review no longer exists, so there is nothing to hide; resolve to close the dispute.</span>
            )}
          </Field>

          {open.status !== 'open' ? (
            <Field name="Resolution">
              <Badge status={open.status} /> {open.resolution_reason || 'No reason recorded'}
              {open.resolved_at ? <span style={{ color: colors.muted }}> · {new Date(open.resolved_at).toLocaleString('en-NG')}</span> : null}
            </Field>
          ) : null}

          <Field name="Moderation history"><History events={history} /></Field>

          {open.status === 'open' ? (
            <ReasonForm
              busy={busy}
              error={actionError}
              placeholder="Explain the decision. It is stored in the audit trail."
              actions={[
                { label: 'Uphold — hide review', tone: 'danger', run: (r) => void resolve('upheld', r) },
                { label: 'Reject — keep review', tone: 'primary', run: (r) => void resolve('rejected', r) },
              ]}
            />
          ) : actionError ? <p style={{ color: colors.danger }}>{actionError}</p> : null}
        </Panel>
      ) : null}

      <FilterBar>
        <div>
          <label style={label()} htmlFor="ds-status">Status</label>
          <select id="ds-status" style={select()} value={status} onChange={(e) => setStatus(e.target.value as DisputeStatus | '')}>
            <option value="open">Open</option>
            <option value="upheld">Upheld</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
        <div>
          <label style={label()} htmlFor="ds-kind">Type</label>
          <select id="ds-kind" style={select()} value={kind} onChange={(e) => setKind(e.target.value as DisputeKind | '')}>
            <option value="">All</option>
            <option value="dispute">Dispute</option>
            <option value="removal_request">Removal request</option>
            <option value="report">Report</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText={status === 'open' ? 'No open disputes — the queue is clear.' : 'No disputes match.'}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Doctor</th><th style={th()}>Type</th><th style={th()}>Complaint</th>
              <th style={th()}>Status</th><th style={th()}>Raised</th><th style={th()} />
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={td()}>{d.doctor_name || <span style={{ color: colors.muted }}>Unknown</span>}</td>
                  <td style={td()}>{KIND_LABEL[d.kind]}</td>
                  <td style={{ ...td(), maxWidth: 360 }}>{d.reason ? (d.reason.length > 120 ? `${d.reason.slice(0, 120)}…` : d.reason) : <span style={{ color: colors.muted }}>No reason given</span>}</td>
                  <td style={td()}><Badge status={d.status} /></td>
                  <td style={td()}>{timeAgo(d.created_at)}</td>
                  <td style={td()}><button style={btn()} onClick={() => void openDispute(d)}>{d.status === 'open' ? 'Resolve' : 'View'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.82rem', color: colors.muted }}>
            <span>{total.toLocaleString('en-NG')} item{total === 1 ? '' : 's'} · page {page} of {pages}</span>
            <span style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={btn()} disabled={offset === 0 || loading} onClick={() => void loadList(Math.max(0, offset - PAGE))}>Previous</button>
              <button style={btn()} disabled={offset + PAGE >= total || loading} onClick={() => void loadList(offset + PAGE)}>Next</button>
            </span>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
