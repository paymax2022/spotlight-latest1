'use client';

// Business Registry — CAC business-name verify/register review console.
// Mirrors the Commission & Stays admin inline-style pattern (no new UI kit). Lists
// business profiles with status/mode filters, a detail drawer (proprietors + CAC
// refs + fee), and Approve / Reject (reason prompt) actions. Approve is a manual
// override to a success terminal state; Reject requires a reason. Money is shown in
// ₦ (feeKobo/100). All state-changes are audit-logged server-side.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  list, get, approve, reject, formatNaira, displayName,
  STATUSES, MODES, TERMINAL_STATUSES,
  type Business, type BusinessStatus, type BusinessMode,
} from '@/services/businessAdminService';

// ── Inline style primitives (match app/admin/commission/_ui.tsx) ──────────────
const th = (): CSSProperties => ({ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' });
const td = (): CSSProperties => ({ padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid #f1f1f1', verticalAlign: 'middle' });
const label = (): CSSProperties => ({ display: 'block', fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 });
const select = (): CSSProperties => ({ width: '100%', padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box' });
function btn(variant: 'primary' | 'ghost' | 'danger' = 'ghost'): CSSProperties {
  const base: CSSProperties = { padding: '0.45rem 0.85rem', borderRadius: 6, fontSize: '0.82rem', cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff', color: '#111' };
  if (variant === 'primary') return { ...base, background: '#111827', color: '#fff', border: '1px solid #111827' };
  if (variant === 'danger') return { ...base, background: '#fff', color: '#b91c1c', border: '1px solid #fca5a5' };
  return base;
}

// Status → badge tone. Success = green, in-flight = blue, review = amber, fail = red.
const STATUS_TONE: Record<BusinessStatus, CSSProperties> = {
  draft: { background: '#f3f4f6', color: '#6b7280' },
  name_check: { background: '#dbeafe', color: '#1d4ed8' },
  name_reserved: { background: '#dbeafe', color: '#1d4ed8' },
  registration_submitted: { background: '#dbeafe', color: '#1d4ed8' },
  submitted: { background: '#dbeafe', color: '#1d4ed8' },
  under_review: { background: '#fef3c7', color: '#92400e' },
  registered: { background: '#dcfce7', color: '#15803d' },
  verified: { background: '#dcfce7', color: '#15803d' },
  rejected: { background: '#fee2e2', color: '#b91c1c' },
  failed: { background: '#fee2e2', color: '#b91c1c' },
};

function StatusBadge({ status }: { status: BusinessStatus }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.draft;
  return <span style={{ ...tone, padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{status.replace(/_/g, ' ')}</span>;
}
function ModeBadge({ mode }: { mode: BusinessMode }) {
  const tone: CSSProperties = mode === 'verify_existing' ? { background: '#ede9fe', color: '#6d28d9' } : { background: '#e0f2fe', color: '#0369a1' };
  return <span style={{ ...tone, padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{mode === 'verify_existing' ? 'verify existing' : 'register new'}</span>;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

const isTerminal = (s: BusinessStatus) => TERMINAL_STATUSES.includes(s);

export default function BusinessRegistryPage() {
  const [rows, setRows] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [fStatus, setFStatus] = useState<BusinessStatus | ''>('');
  const [fMode, setFMode] = useState<BusinessMode | ''>('');

  const [detail, setDetail] = useState<Business | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await list({ status: fStatus || undefined, mode: fMode || undefined, limit: 100 }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [fStatus, fMode]);

  const counts = useMemo(() => ({
    total: rows.length,
    review: rows.filter((b) => b.status === 'under_review').length,
    pending: rows.filter((b) => !isTerminal(b.status)).length,
  }), [rows]);

  async function openDetail(id: string) {
    setDetailLoading(true); setDetail(null); setNotice(null);
    try { setDetail(await get(id)); }
    catch (e) { setNotice(String(e)); }
    finally { setDetailLoading(false); }
  }
  function closeDetail() { setDetail(null); }

  async function onApprove(b: Business) {
    if (typeof window !== 'undefined' && !window.confirm(`Manually approve "${displayName(b)}" to a success terminal state? This overrides the CAC flow.`)) return;
    setBusyId(b.id); setNotice(null);
    try {
      const u = await approve(b.id);
      setNotice(`${displayName(u)} approved → ${u.status}.`);
      if (detail?.id === b.id) setDetail(u);
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusyId(null); }
  }

  async function onReject(b: Business) {
    const reason = typeof window !== 'undefined' ? window.prompt(`Rejection reason for "${displayName(b)}"?`, '') : '';
    if (!reason || !reason.trim()) { setNotice('A rejection reason is required.'); return; }
    setBusyId(b.id); setNotice(null);
    try {
      const u = await reject(b.id, reason.trim());
      setNotice(`${displayName(u)} rejected.`);
      if (detail?.id === b.id) setDetail(u);
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusyId(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Business Registry</h1>
          <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.85rem', maxWidth: 760 }}>
            CAC business-name verification & registration review. Approve is a manual override to a success terminal state (registered / verified); Reject requires a reason. Fees are shown in ₦ (kobo/100). Requires <code>business.registry.review</code>.
          </p>
        </div>
        <button onClick={load} style={btn()}>Refresh</button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { l: 'Total profiles', v: counts.total, a: undefined as string | undefined },
          { l: 'Pending (non-terminal)', v: counts.pending, a: counts.pending > 0 ? '#92400e' : undefined },
          { l: 'Under review', v: counts.review, a: counts.review > 0 ? '#92400e' : undefined },
        ].map((k) => (
          <div key={k.l} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.8rem 0.9rem', background: '#fff' }}>
            <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.l}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, color: k.a ?? '#111' }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', marginBottom: '1.25rem', padding: '0.9rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <label style={label()}>Status</label>
            <select style={{ ...select(), maxWidth: 260 }} value={fStatus} onChange={(e) => setFStatus(e.target.value as BusinessStatus | '')}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220 }}>
            <label style={label()}>Mode</label>
            <select style={{ ...select(), maxWidth: 260 }} value={fMode} onChange={(e) => setFMode(e.target.value as BusinessMode | '')}>
              <option value="">All modes</option>
              {MODES.map((m) => <option key={m} value={m}>{m === 'verify_existing' ? 'verify existing' : 'register new'}</option>)}
            </select>
          </div>
        </div>
      </section>

      {notice && <p style={{ fontSize: '0.82rem', color: '#374151', margin: '0 0 0.75rem' }}>{notice}</p>}

      {/* Table */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.9rem', borderBottom: '1px solid #f1f1f1' }}>
          <strong style={{ fontSize: '0.9rem' }}>Registry queue</strong>
          <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{rows.length} profile{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ padding: '0.9rem' }}>
          {loading ? (
            <p style={{ color: '#6b7280', fontSize: '0.85rem', padding: '1rem 0' }}>Loading…</p>
          ) : error ? (
            <p style={{ color: '#b91c1c', fontSize: '0.85rem', padding: '1rem 0' }}>{error}</p>
          ) : rows.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '0.85rem', padding: '1rem 0' }}>No business profiles match the current filters.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Name</th>
                    <th style={th()}>Entity type</th>
                    <th style={th()}>Mode</th>
                    <th style={th()}>Status</th>
                    <th style={th()}>RC / BN</th>
                    <th style={th()}>Fee</th>
                    <th style={th()}>Submitted</th>
                    <th style={th()}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const terminal = isTerminal(b.status);
                    return (
                      <tr key={b.id}>
                        <td style={{ ...td(), fontWeight: 600 }}>
                          <button onClick={() => openDetail(b.id)} style={{ background: 'none', border: 'none', padding: 0, color: '#1d4ed8', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', textAlign: 'left' }}>
                            {displayName(b)}
                          </button>
                          <div style={{ color: '#9ca3af', fontSize: '0.72rem', fontWeight: 400 }}>{b.lineOfBusiness || '—'}</div>
                        </td>
                        <td style={td()}>{(b.entityType || '—').replace(/_/g, ' ')}</td>
                        <td style={td()}><ModeBadge mode={b.mode} /></td>
                        <td style={td()}><StatusBadge status={b.status} /></td>
                        <td style={td()}>{b.rcOrBnNumber ? <code>{b.rcOrBnNumber}</code> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td style={td()}>{formatNaira(b.feeKobo)}</td>
                        <td style={td()}>{fmtDate(b.createdAt)}</td>
                        <td style={td()}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button onClick={() => openDetail(b.id)} style={btn()}>View</button>
                            {terminal ? (
                              <span style={{ color: '#9ca3af', fontSize: '0.8rem', alignSelf: 'center' }}>resolved</span>
                            ) : (
                              <>
                                <button onClick={() => onApprove(b)} disabled={busyId === b.id} style={btn('primary')}>{busyId === b.id ? '…' : 'Approve'}</button>
                                <button onClick={() => onReject(b)} disabled={busyId === b.id} style={btn('danger')}>Reject</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Detail drawer */}
      {(detail || detailLoading) && (
        <DetailDrawer
          business={detail}
          loading={detailLoading}
          busy={detail ? busyId === detail.id : false}
          onClose={closeDetail}
          onApprove={detail ? () => onApprove(detail) : undefined}
          onReject={detail ? () => onReject(detail) : undefined}
        />
      )}
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────
function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f1f1f1', fontSize: '0.85rem' }}>
      <div style={{ color: '#6b7280' }}>{k}</div>
      <div>{v ?? '—'}</div>
    </div>
  );
}

function DetailDrawer({ business, loading, busy, onClose, onApprove, onReject }: {
  business: Business | null; loading: boolean; busy: boolean;
  onClose: () => void; onApprove?: () => void; onReject?: () => void;
}) {
  const terminal = business ? isTerminal(business.status) : true;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 520, height: '100%', overflowY: 'auto', padding: '1.25rem', boxSizing: 'border-box' }}>
        {loading || !business ? (
          <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.75rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{displayName(business)}</h2>
                <div style={{ marginTop: '0.4rem', display: 'flex', gap: 6 }}>
                  <StatusBadge status={business.status} />
                  <ModeBadge mode={business.mode} />
                </div>
              </div>
              <button onClick={onClose} style={btn()}>Close</button>
            </div>

            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '1rem 0 0.25rem' }}>Profile</h3>
            <Row k="Business ID" v={<code>{business.id}</code>} />
            <Row k="User ID" v={<code>{business.userId}</code>} />
            <Row k="Entity type" v={(business.entityType || '—').replace(/_/g, ' ')} />
            <Row k="Legal name" v={business.legalName || '—'} />
            <Row k="Proposed name" v={business.proposedName || '—'} />
            <Row k="Line of business" v={business.lineOfBusiness || '—'} />
            <Row k="Submitted" v={fmtDate(business.createdAt)} />
            <Row k="Last updated" v={fmtDate(business.updatedAt)} />
            <Row k="Registered at" v={fmtDate(business.registeredAt)} />

            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '1rem 0 0.25rem' }}>CAC references</h3>
            <Row k="RC / BN number" v={business.rcOrBnNumber ? <code>{business.rcOrBnNumber}</code> : '—'} />
            <Row k="Reservation ref" v={business.cacReservationRef ? <code>{business.cacReservationRef}</code> : '—'} />
            <Row k="Registration ref" v={business.cacRegistrationRef ? <code>{business.cacRegistrationRef}</code> : '—'} />
            <Row k="Verification source" v={business.verificationSource || '—'} />
            <Row
              k="Certificate"
              v={business.certificateUrl
                ? <a href={business.certificateUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>View certificate</a>
                : '—'}
            />

            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '1rem 0 0.25rem' }}>Fee</h3>
            <Row k="Fee" v={<strong>{formatNaira(business.feeKobo)}</strong>} />
            <Row k="Ledger ref" v={business.feeLedgerRef ? <code>{business.feeLedgerRef}</code> : '—'} />

            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '1rem 0 0.25rem' }}>
              Proprietors {business.proprietors?.length ? `(${business.proprietors.length})` : ''}
            </h3>
            {business.proprietors?.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.5rem' }}>
                <thead>
                  <tr>
                    <th style={th()}>Name</th>
                    <th style={th()}>Role</th>
                    <th style={th()}>Contact</th>
                    <th style={th()}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {business.proprietors.map((p, i) => (
                    <tr key={p.id ?? i}>
                      <td style={td()}><strong>{p.name || '—'}</strong>{p.bvn ? <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>BVN <code>{p.bvn}</code></div> : null}</td>
                      <td style={td()}>{p.role || '—'}</td>
                      <td style={td()}>
                        <div>{p.email || '—'}</div>
                        {p.phone ? <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{p.phone}</div> : null}
                      </td>
                      <td style={td()}>{typeof p.sharePct === 'number' ? `${p.sharePct}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No proprietors on record.</p>
            )}

            {business.metadata && Object.keys(business.metadata).length > 0 ? (
              <>
                <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '1rem 0 0.25rem' }}>Metadata</h3>
                <pre style={{ background: '#f9fafb', border: '1px solid #f1f1f1', borderRadius: 6, padding: '0.6rem', fontSize: '0.72rem', overflowX: 'auto', margin: 0 }}>
                  {JSON.stringify(business.metadata, null, 2)}
                </pre>
              </>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb' }}>
              {terminal ? (
                <span style={{ color: '#9ca3af', fontSize: '0.82rem', alignSelf: 'center' }}>This profile is in a terminal state ({business.status.replace(/_/g, ' ')}).</span>
              ) : (
                <>
                  <button onClick={onReject} disabled={busy} style={btn('danger')}>Reject</button>
                  <button onClick={onApprove} disabled={busy} style={btn('primary')}>{busy ? 'Working…' : 'Approve (override)'}</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
