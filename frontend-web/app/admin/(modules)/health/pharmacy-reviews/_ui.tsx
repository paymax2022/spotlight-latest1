'use client';

// Pharmacist review queue — symptom-search gated orders (PRD §8 console
// screens, §9 SLA). SLA-sorted (soonest deadline first, overdue highlighted);
// case drawer with symptoms context, cart, cohort flags, state history;
// APPROVE / REJECT / NEEDS_INFO decisions (note required for the latter two)
// with optimistic update + rollback. RBAC: health.pharmacy.symptom.reviews —
// UI gate is convenience only; the Go backend enforces object-level authz
// (a pharmacist only sees/decides cases for their premises tenant).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import {
  listReviewCases,
  getReviewCase,
  decideReviewCase,
  getSafetyMetrics,
  formatNaira,
  slaStatus,
  type PharmacyReviewCase,
  type PharmacyReviewCaseDetail,
  type ReviewDecision,
  type ReviewState,
  type SymptomSafetyMetrics,
  type TriageTier,
} from '@/services/pharmacySymptomAdminService';
import { PageHeader, Card, DisclosureNote, AuditNote, StateBlock, Kpi, btn, btnPrimary, btnDanger, th, td, label as labelStyle, input, timeAgo, pct } from '../_ui';

export const SYMPTOM_REVIEW_PERMS = ['health.pharmacy.symptom.reviews'];

// Mirrors useIntakePermissions (app/admin/intake/_ui.tsx): reads the cached
// admin user so write affordances can be disabled; server stays authoritative.
function useSymptomPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      /* unauthenticated handled by route guard */
    }
  }, []);
  return { user, can: (perms: string[]) => hasAnyPermission(user, perms) };
}

// ── Tier + state badges (T1–T4 colour-coded by severity) ─────────────────────

const TIER_COLORS: Record<TriageTier, { fg: string; bg: string; label: string }> = {
  T1: { fg: '#15803d', bg: '#dcfce7', label: 'T1 · self-care' },
  T2: { fg: '#1d4ed8', bg: '#dbeafe', label: 'T2 · pharmacist-guided' },
  T3: { fg: '#9a3412', bg: '#ffedd5', label: 'T3 · consult required' },
  T4: { fg: '#b91c1c', bg: '#fee2e2', label: 'T4 · emergency' },
};

export function TierBadge({ tier, compact }: { tier: TriageTier; compact?: boolean }) {
  const c = TIER_COLORS[tier];
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700, color: c.fg, background: c.bg, whiteSpace: 'nowrap' }}>
      {compact ? tier : c.label}
    </span>
  );
}

const STATE_COLORS: Record<ReviewState, { fg: string; bg: string }> = {
  SUBMITTED: { fg: '#9a3412', bg: '#ffedd5' },
  AUTO_CLEARED: { fg: '#6b7280', bg: '#f3f4f6' },
  PHARMACIST_REVIEW: { fg: '#1d4ed8', bg: '#dbeafe' },
  NEEDS_INFO: { fg: '#9a3412', bg: '#ffedd5' },
  APPROVED: { fg: '#15803d', bg: '#dcfce7' },
  REJECTED: { fg: '#b91c1c', bg: '#fee2e2' },
};

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  const c = STATE_COLORS[state] ?? { fg: '#374151', bg: '#f3f4f6' };
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, whiteSpace: 'nowrap' }}>
      {state.replace(/_/g, ' ')}
    </span>
  );
}

const chip = (active: boolean): CSSProperties => ({
  padding: '0.3rem 0.7rem', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  border: active ? '1px solid #340075' : '1px solid #d1d5db',
  background: active ? '#340075' : '#fff', color: active ? '#fff' : '#374151',
});

const STATES: Array<ReviewState> = ['SUBMITTED', 'PHARMACIST_REVIEW', 'NEEDS_INFO', 'AUTO_CLEARED', 'APPROVED', 'REJECTED'];
const TIERS: Array<TriageTier> = ['T1', 'T2', 'T3', 'T4'];
const DECIDABLE: ReviewState[] = ['SUBMITTED', 'PHARMACIST_REVIEW', 'NEEDS_INFO'];

// ── Safety-KPI strip (PRD §9 — dashboard-pinned, reviewed weekly with the
// superintendent pharmacist). Defensive: the metrics endpoint is being built
// in parallel — null metrics render an em-dash skeleton, never an error.

const DASH = '—';

function fmtDecisionTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return DASH;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function openStateBreakdown(byState: SymptomSafetyMetrics['by_state']): string {
  const parts: string[] = [];
  for (const st of DECIDABLE) {
    const n = byState[st] ?? 0;
    if (n > 0) parts.push(`${n} ${st.replace(/_/g, ' ').toLowerCase()}`);
  }
  return parts.length ? parts.join(' · ') : 'queue clear';
}

function SafetyKpiStrip({ metrics, unavailable }: { metrics: SymptomSafetyMetrics | null; unavailable: boolean }) {
  const open = metrics ? DECIDABLE.reduce((s, st) => s + (metrics.by_state[st] ?? 0), 0) : null;
  const overdue = metrics?.open_overdue ?? null;
  const median = metrics?.median_decision_seconds ?? null;
  const offlineSub = unavailable ? 'metrics endpoint not deployed' : 'loading…';
  const medianOver = median != null && median > 600; // PRD §9: median <10 min
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
      <Kpi
        label="Open cases"
        value={open != null ? String(open) : DASH}
        sub={metrics ? openStateBreakdown(metrics.by_state) : offlineSub}
      />
      <Kpi
        label="Overdue (SLA)"
        value={overdue != null ? String(overdue) : DASH}
        sub={metrics ? 'open cases past deadline' : offlineSub}
        accent={overdue != null ? (overdue > 0 ? '#b91c1c' : '#15803d') : undefined}
      />
      <Kpi
        label="Median decision"
        value={metrics ? fmtDecisionTime(median) : DASH}
        sub={metrics ? 'target < 10 min (08:00–22:00 WAT)' : offlineSub}
        accent={metrics && median != null ? (medianOver ? '#b91c1c' : '#15803d') : undefined}
      />
      <Kpi
        label="Searches (24h)"
        value={metrics ? String(metrics.searches_24h) : DASH}
        sub={metrics ? 'symptom searches, all tiers' : offlineSub}
      />
      <Kpi
        label="Gated share (7d)"
        value={metrics && metrics.gated_share_7d != null ? pct(metrics.gated_share_7d) : DASH}
        sub={metrics ? 'searches landing T2+ (any T2/T3 leak is Sev-1)' : offlineSub}
      />
    </div>
  );
}

type Flash = { kind: 'ok' | 'error'; text: string } | null;

export default function PharmacyReviewQueue() {
  const { can } = useSymptomPermissions();
  const canDecide = can(SYMPTOM_REVIEW_PERMS);

  const [rows, setRows] = useState<PharmacyReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<ReviewState | ''>('');
  const [tierFilter, setTierFilter] = useState<TriageTier | ''>('');
  const [metrics, setMetrics] = useState<SymptomSafetyMetrics | null>(null);
  const [metricsUnavailable, setMetricsUnavailable] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PharmacyReviewCaseDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState<ReviewDecision | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    // Safety-KPI strip loads alongside the queue but never blocks it — a
    // missing/failed metrics endpoint degrades to an em-dash skeleton.
    getSafetyMetrics()
      .then((m) => { setMetrics(m); setMetricsUnavailable(m === null); })
      .catch(() => { setMetrics(null); setMetricsUnavailable(true); });
    try {
      setRows(await listReviewCases({ state: stateFilter, tier: tierFilter }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [stateFilter, tierFilter]);
  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  async function openCase(id: string) {
    setSelectedId(id); setDetail(null); setDetailError(null); setNote(''); setFlash(null);
    try {
      const d = await getReviewCase(id);
      setDetail(d ?? null);
      if (!d) setDetailError('Case detail unavailable — showing queue-row fields only.');
    } catch {
      setDetailError('Case detail unavailable — showing queue-row fields only.');
    }
  }

  function closeDrawer() {
    setSelectedId(null); setDetail(null); setDetailError(null); setNote(''); setDeciding(null);
  }

  // Optimistic update: flip the row state immediately, roll back on error.
  async function decide(decision: ReviewDecision) {
    if (!selected) return;
    const trimmed = note.trim();
    if ((decision === 'REJECT' || decision === 'NEEDS_INFO') && !trimmed) {
      setFlash({ kind: 'error', text: `A note is required for ${decision.replace('_', ' ')} — it is shown to the customer and recorded in the audit trail.` });
      return;
    }
    const prevRows = rows.map((r) => ({ ...r }));
    const nextState: ReviewState = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'NEEDS_INFO';
    setDeciding(decision);
    setFlash(null);
    setRows((rs) => rs.map((r) => (r.id === selected.id ? { ...r, state: nextState, decision_note: trimmed || r.decision_note, updated_at: new Date().toISOString() } : r)));
    try {
      const updated = await decideReviewCase(selected.id, decision, trimmed);
      setRows((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      setDetail((d) => (d && d.id === updated.id ? { ...d, ...updated } : d));
      setFlash({
        kind: 'ok',
        text:
          decision === 'APPROVE' ? `Case ${selected.id} approved — order released to fulfilment. Audit-logged.`
          : decision === 'REJECT' ? `Case ${selected.id} rejected — refund runs as a ledger reversal entry (never a balance edit). Audit-logged.`
          : `Case ${selected.id} set to NEEDS INFO — customer notified; case returns to your queue on reply. Audit-logged.`,
      });
      setNote('');
    } catch (e) {
      setRows(prevRows); // rollback
      setFlash({ kind: 'error', text: `Decision failed — no state change applied. ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setDeciding(null);
    }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Symptom-search review queue"
        subtitle="Gated orders from symptom-based medication search awaiting pharmacist decision. SLA-sorted — soonest deadline first, overdue highlighted. Target: median review under 10 minutes (08:00–22:00 WAT)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <DisclosureNote>
        Decisions are guarded state-machine transitions (PHARMACIST_REVIEW → APPROVED | REJECTED | NEEDS_INFO), idempotent and audit-logged with actor.
        REJECT triggers the refund path via ledger reversal entries. You only see cases assigned to your premises tenant (object-level authz).
        This surface reviews symptom-guided product options — never diagnosis, never prescribing.
      </DisclosureNote>

      <SafetyKpiStrip metrics={metrics} unavailable={metricsUnavailable} />

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>State</span>
        <button style={chip(stateFilter === '')} onClick={() => setStateFilter('')}>All</button>
        {STATES.map((s) => (
          <button key={s} style={chip(stateFilter === s)} onClick={() => setStateFilter(stateFilter === s ? '' : s)}>{s.replace(/_/g, ' ')}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Tier</span>
        <button style={chip(tierFilter === '')} onClick={() => setTierFilter('')}>All</button>
        {TIERS.map((t) => (
          <button key={t} style={chip(tierFilter === t)} onClick={() => setTierFilter(tierFilter === t ? '' : t)}>{TIER_COLORS[t].label}</button>
        ))}
      </div>

      {flash && !selected ? <FlashBanner flash={flash} /> : null}

      <Card title="Review cases (SLA-sorted)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{rows.length} case{rows.length === 1 ? '' : 's'}</span>}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No review cases match — the queue is clear (or the symptom-review backend is not deployed yet).">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Case</th><th style={th()}>Order</th><th style={th()}>Tier</th><th style={th()}>State</th>
              <th style={th()}>SLA deadline</th><th style={th()}>Pharmacist</th><th style={th()}>Created</th><th style={th()} />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const sla = slaStatus(r.sla_deadline);
                const slaActive = DECIDABLE.includes(r.state);
                const rowBg = sla.overdue && slaActive ? '#fef2f2' : r.id === selectedId ? '#f5f3ff' : undefined;
                return (
                  <tr key={r.id} style={{ background: rowBg, cursor: 'pointer' }} onClick={() => openCase(r.id)}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code></td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.order_id}</code></td>
                    <td style={td()}><TierBadge tier={r.tier} /></td>
                    <td style={td()}><ReviewStateBadge state={r.state} /></td>
                    <td style={td()}>
                      {slaActive ? (
                        <span style={{ fontWeight: 700, color: sla.overdue ? '#b91c1c' : '#15803d' }}>
                          {sla.overdue ? '⚠ ' : ''}{sla.label}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>closed</span>
                      )}
                    </td>
                    <td style={td()}>{r.pharmacist_id ? <code style={{ fontSize: '0.78rem' }}>{r.pharmacist_id}</code> : <span style={{ color: '#9ca3af' }}>unassigned</span>}</td>
                    <td style={td()}>{timeAgo(r.created_at)}</td>
                    <td style={td()}><button style={btn()} onClick={(e) => { e.stopPropagation(); openCase(r.id); }}>Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {selected ? (
        <CaseDrawer
          row={selected}
          detail={detail}
          detailError={detailError}
          note={note}
          setNote={setNote}
          deciding={deciding}
          canDecide={canDecide}
          flash={flash}
          onDecide={decide}
          onClose={closeDrawer}
        />
      ) : null}
    </div>
  );
}

function FlashBanner({ flash }: { flash: NonNullable<Flash> }) {
  const ok = flash.kind === 'ok';
  return (
    <div style={{ border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`, background: ok ? '#f0fdf4' : '#fef2f2', color: ok ? '#15803d' : '#b91c1c', borderRadius: '0.5rem', padding: '0.55rem 0.8rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
      {flash.text}
    </div>
  );
}

function CaseDrawer({ row, detail, detailError, note, setNote, deciding, canDecide, flash, onDecide, onClose }: {
  row: PharmacyReviewCase;
  detail: PharmacyReviewCaseDetail | null;
  detailError: string | null;
  note: string;
  setNote: (v: string) => void;
  deciding: ReviewDecision | null;
  canDecide: boolean;
  flash: Flash;
  onDecide: (d: ReviewDecision) => void;
  onClose: () => void;
}) {
  const sla = slaStatus(row.sla_deadline);
  const decidable = DECIDABLE.includes(row.state);
  const noteRequiredMissing = note.trim().length === 0;
  const cartTotal = (detail?.cart_lines ?? []).reduce((s, l) => s + l.line_total_kobo, 0);
  const sectionTitle: CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0.9rem 0 0.35rem' };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.35)', zIndex: 40 }} />
      <aside role="dialog" aria-label={`Review case ${row.id}`} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 92vw)', background: '#fff', borderLeft: '1px solid #e5e7eb', boxShadow: '-8px 0 24px rgba(0,0,0,0.08)', zIndex: 41, overflowY: 'auto', padding: '1rem 1.1rem 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Case <code style={{ fontSize: '0.9rem' }}>{row.id}</code></h2>
            <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>Order <code>{row.order_id}</code></div>
          </div>
          <button style={btn()} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.7rem', alignItems: 'center' }}>
          <TierBadge tier={row.tier} />
          <ReviewStateBadge state={row.state} />
          {decidable ? (
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: sla.overdue ? '#b91c1c' : '#15803d' }}>{sla.overdue ? '⚠ SLA ' : 'SLA '}{sla.label}</span>
          ) : null}
        </div>

        {detailError ? <p style={{ fontSize: '0.78rem', color: '#9a3412', background: '#ffedd5', borderRadius: '0.375rem', padding: '0.4rem 0.6rem', marginTop: '0.7rem' }}>{detailError}</p> : null}
        {!detail && !detailError ? <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '0.9rem' }}>Loading case detail…</p> : null}

        {detail ? (
          <>
            <div style={sectionTitle}>Symptoms context (sensitive — NDPR)</div>
            <div style={{ fontSize: '0.85rem', color: '#374151' }}>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                {detail.symptom_terms.map((t) => (
                  <span key={t} style={{ padding: '0.1rem 0.5rem', borderRadius: 9999, background: '#f3f4f6', fontSize: '0.75rem' }}>&ldquo;{t}&rdquo;</span>
                ))}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>Resolved concepts: {detail.matched_concepts.join(', ') || '—'}</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>Cluster: {detail.cluster_name ?? '—'}</div>
            </div>

            <div style={sectionTitle}>Cohort flags</div>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              {detail.cohort_flags.length === 0 ? <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>none</span> : detail.cohort_flags.map((f) => (
                <span key={f} style={{ padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: f.startsWith('PREGNANT') || f.startsWith('CHILD') ? '#9a3412' : '#374151', background: f.startsWith('PREGNANT') || f.startsWith('CHILD') ? '#ffedd5' : '#f3f4f6' }}>{f.replace(/_/g, ' ')}</span>
              ))}
            </div>

            <div style={sectionTitle}>Cart lines</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Product</th><th style={th()}>Class</th><th style={th()}>Qty</th><th style={th()}>Total</th></tr></thead>
              <tbody>
                {detail.cart_lines.map((l, i) => (
                  <tr key={i}>
                    <td style={td()}>{l.product_name}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>NAFDAC {l.nafdac_reg_no ?? '—'}</div></td>
                    <td style={td()}><span style={{ fontSize: '0.72rem', fontWeight: 600, color: l.classification === 'OTC' ? '#6b7280' : '#9a3412' }}>{l.classification.replace(/_/g, ' ')}</span></td>
                    <td style={td()}>{l.qty}</td>
                    <td style={td()}>{formatNaira(l.line_total_kobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontSize: '0.82rem', fontWeight: 700, marginTop: '0.35rem' }}>Cart total: {formatNaira(cartTotal)}</div>

            <div style={sectionTitle}>State history</div>
            <ol style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {detail.history.map((h, i) => (
                <li key={i} style={{ fontSize: '0.8rem', color: '#374151', marginBottom: '0.35rem' }}>
                  <ReviewStateBadge state={h.state} /> <span style={{ color: '#9ca3af' }}>{timeAgo(h.at)} · {h.actor}</span>
                  {h.note ? <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{h.note}</div> : null}
                </li>
              ))}
            </ol>
          </>
        ) : null}

        {flash ? <div style={{ marginTop: '0.8rem' }}><FlashBanner flash={flash} /></div> : null}

        {decidable ? (
          <>
            <div style={sectionTitle}>Decision</div>
            {!canDecide ? (
              <p style={{ fontSize: '0.78rem', color: '#9a3412', background: '#ffedd5', borderRadius: '0.375rem', padding: '0.4rem 0.6rem' }}>
                You do not hold health.pharmacy.symptom.reviews — decision actions are disabled. The server enforces this regardless.
              </p>
            ) : null}
            <label style={labelStyle()}>Note {noteRequiredMissing ? <span style={{ color: '#b91c1c' }}>(required for Reject / Needs info)</span> : null}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Pharmacist note — customer-visible for Needs info; recorded to the immutable audit log."
              style={{ ...input(), resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
              <button
                style={{ ...btnPrimary(), opacity: canDecide && !deciding ? 1 : 0.5 }}
                disabled={!canDecide || deciding !== null}
                onClick={() => onDecide('APPROVE')}
              >{deciding === 'APPROVE' ? 'Approving…' : 'Approve'}</button>
              <button
                style={{ ...btn(), opacity: canDecide && !deciding && !noteRequiredMissing ? 1 : 0.5 }}
                disabled={!canDecide || deciding !== null || noteRequiredMissing}
                onClick={() => onDecide('NEEDS_INFO')}
              >{deciding === 'NEEDS_INFO' ? 'Sending…' : 'Needs info'}</button>
              <button
                style={{ ...btnDanger(), opacity: canDecide && !deciding && !noteRequiredMissing ? 1 : 0.5 }}
                disabled={!canDecide || deciding !== null || noteRequiredMissing}
                onClick={() => onDecide('REJECT')}
              >{deciding === 'REJECT' ? 'Rejecting…' : 'Reject'}</button>
            </div>
            <AuditNote>Every decision is a guarded, idempotent state transition recorded to the immutable audit log with actor and timestamp. Reject refunds via ledger reversal entries.</AuditNote>
          </>
        ) : (
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '1rem' }}>
            This case is in a terminal or system state ({row.state.replace(/_/g, ' ')}) — no decision available.
            {row.decision_note ? <><br />Decision note: <em>{row.decision_note}</em></> : null}
          </p>
        )}
      </aside>
    </>
  );
}
