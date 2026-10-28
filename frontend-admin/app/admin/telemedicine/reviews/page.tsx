'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getReview, getReviewsSummary, hideReview, listReviews, unhideReview,
  SOURCE_LABEL,
  type ReviewDetail, type ReviewFilter, type ReviewRecord, type ReviewsSummary, type ReviewSource,
} from '@/services/telemedAdminReviewsService';
import {
  PageHeader, TelemedTabs, Card, Kpi, Badge, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate, timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';
import { ReviewsTabs, Stars, Panel, Field, History, ReasonForm } from './_parts';

const PAGE = 25;

export default function ReviewModerationPage() {
  const [summary, setSummary] = useState<ReviewsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<ReviewFilter['source']>('');
  const [rating, setRating] = useState<ReviewFilter['rating']>('');
  const [hidden, setHidden] = useState<ReviewFilter['hidden']>('');
  const [doctorId, setDoctorId] = useState('');
  const [q, setQ] = useState('');

  const [open, setOpen] = useState<ReviewDetail | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try { setSummary(await getReviewsSummary()); } catch (e) { setSummary(null); setSummaryError(String((e as Error).message ?? e)); }
  }, []);

  const loadList = useCallback(async (nextOffset: number) => {
    setLoading(true); setError(null);
    try {
      const page = await listReviews({ source, rating, hidden, doctorId, q, limit: PAGE, offset: nextOffset });
      setRows(page.rows); setTotal(page.total); setOffset(nextOffset);
    } catch (e) {
      setRows([]); setTotal(0); setError(String((e as Error).message ?? e));
    } finally { setLoading(false); }
  }, [source, rating, hidden, doctorId, q]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadList(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source, rating, hidden]);

  async function openReview(r: ReviewRecord) {
    setOpenError(null); setActionError(null);
    try { setOpen(await getReview(r.source, r.id)); } catch (e) { setOpen(null); setOpenError(String((e as Error).message ?? e)); }
  }

  async function moderate(kind: 'hide' | 'unhide', reason: string) {
    if (!open) return;
    setBusy(true); setActionError(null);
    try {
      await (kind === 'hide' ? hideReview : unhideReview)(open.source, open.id, reason);
      setOpen(await getReview(open.source, open.id));
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
        title="Review moderation"
        subtitle="Patient reviews from consultations and the doctor app. Hiding a review removes it from patient-facing lists and the doctor's rating; every action is audited."
        action={<button style={btn()} onClick={() => { void loadSummary(); void loadList(offset); }}>Refresh</button>}
      />
      <TelemedTabs active="reviews" />
      <ReviewsTabs active="reviews" />

      {summaryError ? (
        <p style={{ color: colors.danger, fontSize: '0.85rem' }}>Summary unavailable: {summaryError}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Reviews" value={summary ? summary.total_reviews.toLocaleString('en-NG') : '…'} />
          <Kpi label="Hidden" value={summary ? summary.hidden_reviews.toLocaleString('en-NG') : '…'} />
          <Kpi label="Low-rated, visible" value={summary ? summary.low_rated_visible.toLocaleString('en-NG') : '…'} sub="1–2 stars" accent={summary && summary.low_rated_visible > 0 ? '#9a3412' : undefined} />
          <Kpi label="Reported" value={summary ? summary.reported_reviews.toLocaleString('en-NG') : '…'} />
          <Kpi label="Open disputes" value={summary ? summary.open_disputes.toLocaleString('en-NG') : '…'} accent={summary && summary.open_disputes > 0 ? colors.danger : undefined} />
        </div>
      )}

      {openError ? <p style={{ color: colors.danger }}>{openError}</p> : null}
      {open ? (
        <Panel title={`${SOURCE_LABEL[open.source]} — ${open.doctor_name || 'Unknown doctor'}`} onClose={() => { setOpen(null); setActionError(null); }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem 1.5rem' }}>
            <Field name="Rating"><Stars rating={open.rating} /></Field>
            <Field name="Status">
              {open.hidden ? <Badge status="rejected" label="Hidden" /> : <Badge status="active" label="Visible" />}
              {open.reported ? <> <Badge status="pending" label="Reported" /></> : null}
            </Field>
            <Field name="Patient">{open.patient_ref || '—'}</Field>
            <Field name="Posted">{new Date(open.created_at).toLocaleString('en-NG')}</Field>
          </div>
          <Field name="Review">{open.comment || <span style={{ color: colors.muted }}>No written comment.</span>}</Field>
          {open.hidden && open.hidden_reason ? <Field name="Hidden because">{open.hidden_reason}</Field> : null}

          {open.disputes.length > 0 ? (
            <Field name="Disputes on this review">
              {open.disputes.map((d) => (
                <div key={d.id}>
                  <Badge status={d.status} /> {d.kind.replace(/_/g, ' ')} — {d.reason || 'no reason given'} ({timeAgo(d.created_at)})
                </div>
              ))}
            </Field>
          ) : null}

          <Field name="Moderation history"><History events={open.history} /></Field>

          <ReasonForm
            busy={busy}
            error={actionError}
            actions={[open.hidden
              ? { label: 'Restore review', tone: 'primary', run: (r) => void moderate('unhide', r) }
              : { label: 'Hide review', tone: 'danger', run: (r) => void moderate('hide', r) }]}
          />
        </Panel>
      ) : null}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()} htmlFor="rv-q">Search</label>
          <input id="rv-q" style={input()} placeholder="Comment or doctor name…" value={q} maxLength={100}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadList(0)} />
        </div>
        <div>
          <label style={label()} htmlFor="rv-source">Source</label>
          <select id="rv-source" style={select()} value={source} onChange={(e) => setSource(e.target.value as ReviewSource | '')}>
            <option value="">All</option>
            <option value="telemedicine">Consultation reviews</option>
            <option value="doctor_module">Doctor-app reviews</option>
          </select>
        </div>
        <div>
          <label style={label()} htmlFor="rv-rating">Rating</label>
          <select id="rv-rating" style={select()} value={String(rating)} onChange={(e) => setRating(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div>
          <label style={label()} htmlFor="rv-hidden">Visibility</label>
          <select id="rv-hidden" style={select()} value={hidden} onChange={(e) => setHidden(e.target.value as 'true' | 'false' | '')}>
            <option value="">All</option>
            <option value="false">Visible</option>
            <option value="true">Hidden</option>
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={label()} htmlFor="rv-doctor">Doctor id</label>
          <input id="rv-doctor" style={input()} placeholder="Doctor UUID" value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadList(0)} />
        </div>
        <button style={btn()} onClick={() => void loadList(0)}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reviews match these filters.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Doctor</th><th style={th()}>Rating</th><th style={th()}>Review</th>
              <th style={th()}>Source</th><th style={th()}>Status</th><th style={th()}>Posted</th><th style={th()} />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.source}:${r.id}`}>
                  <td style={td()}>{r.doctor_name || <span style={{ color: colors.muted }}>Unknown</span>}</td>
                  <td style={td()}><Stars rating={r.rating} /></td>
                  <td style={{ ...td(), maxWidth: 360 }}>{r.comment ? (r.comment.length > 140 ? `${r.comment.slice(0, 140)}…` : r.comment) : <span style={{ color: colors.muted }}>No comment</span>}</td>
                  <td style={td()}>{SOURCE_LABEL[r.source]}</td>
                  <td style={td()}>
                    {r.hidden ? <Badge status="rejected" label="Hidden" /> : <Badge status="active" label="Visible" />}
                    {r.reported ? <> <Badge status="pending" label="Reported" /></> : null}
                    {r.open_disputes > 0 ? <> <Badge status="open" label={`${r.open_disputes} dispute${r.open_disputes > 1 ? 's' : ''}`} /></> : null}
                  </td>
                  <td style={td()}>{fmtDate(r.created_at)}</td>
                  <td style={td()}><button style={btn()} onClick={() => void openReview(r)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.82rem', color: colors.muted }}>
            <span>{total.toLocaleString('en-NG')} review{total === 1 ? '' : 's'} · page {page} of {pages}</span>
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
