'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getRxSummary, listPrescriptions, listFulfilments, listRefills, getPrescription, flagPrescription, unflagPrescription,
  type RxSummary, type RxRow, type FulfilmentRow, type RefillRow, type RxDetail, type Page,
} from '@/services/telemedAdminPrescriptionsService';
import { formatNaira } from '@/services/telemedicineAdminService';
import {
  PageHeader, TelemedTabs, Card, Kpi, Badge, StateBlock, FilterBar, DisclosureNote,
  btn, btnDanger, th, td, input, label, select, fmtDate, timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

type View = 'prescriptions' | 'fulfilments' | 'refills';
const PAGE = 20;

export default function PrescriptionsPage() {
  const [view, setView] = useState<View>('prescriptions');
  const [summary, setSummary] = useState<RxSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [flagged, setFlagged] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);

  const [rx, setRx] = useState<Page<RxRow>>({ rows: [], total: 0 });
  const [ful, setFul] = useState<Page<FulfilmentRow>>({ rows: [], total: 0 });
  const [ref, setRef] = useState<Page<RefillRow>>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try { setSummary(await getRxSummary()); setSummaryError(null); }
    catch (e) { setSummaryError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (view === 'prescriptions') {
        setRx(await listPrescriptions({
          status: status || undefined, doctor_id: doctorId.trim() || undefined, from: from || undefined, to: to || undefined,
          flagged: flagged === '' ? undefined : flagged === 'true', q: q.trim() || undefined, limit: PAGE, offset,
        }));
      } else if (view === 'fulfilments') {
        setFul(await listFulfilments({ status: status || undefined, limit: PAGE, offset }));
      } else {
        setRef(await listRefills({ status: status || undefined, limit: PAGE, offset }));
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [view, status, flagged, from, to, doctorId, q, offset]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void load(); }, [load]);

  function switchView(v: View) { setView(v); setStatus(''); setOffset(0); }
  function apply() { if (offset === 0) void load(); else setOffset(0); }

  const total = view === 'prescriptions' ? rx.total : view === 'fulfilments' ? ful.total : ref.total;
  const statusOptions = view === 'prescriptions'
    ? ['draft', 'issued', 'dispensed', 'cancelled']
    : view === 'refills' ? ['pending', 'approved', 'rejected', 'consultation_required']
      : ['pending', 'processing', 'ready', 'dispatched', 'received', 'delivered', 'cancelled'];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Prescriptions"
        subtitle="Oversight of e-prescriptions, pharmacy fulfilment and refill requests across the telemedicine book."
        action={<button style={btn()} onClick={() => { void loadSummary(); void load(); }}>Refresh</button>}
      />
      <TelemedTabs active="prescriptions" />
      <DisclosureNote>
        Patient identity is masked in lists. Opening a prescription reveals it and records the access in the
        clinical record access log. Flagging adds an audit entry for follow-up; it never alters or cancels a prescription.
      </DisclosureNote>

      {summaryError ? (
        <p style={{ color: '#dc2626' }}>Could not load the summary: {summaryError}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Issued (30d)" value={summary ? summary.issued_30d.toLocaleString('en-NG') : '…'} accent="#340075" />
          <Kpi label="Pending fulfilment" value={summary ? summary.pending_fulfilment.toLocaleString('en-NG') : '…'} />
          <Kpi label="Flagged for review" value={summary ? summary.flagged.toLocaleString('en-NG') : '…'} accent={summary && summary.flagged > 0 ? '#9a3412' : undefined} />
          <Kpi label="Refills pending" value={summary ? summary.refills_pending.toLocaleString('en-NG') : '…'} />
          <Kpi label="Substitutions pending" value={summary ? summary.substitutions_pending.toLocaleString('en-NG') : '…'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem' }}>
        {(['prescriptions', 'fulfilments', 'refills'] as View[]).map((v) => (
          <button key={v} onClick={() => switchView(v)}
            style={{ ...btn(), fontWeight: 600, background: view === v ? colors.primary : undefined, color: view === v ? '#fff' : undefined }}>
            {v === 'prescriptions' ? 'Prescriptions' : v === 'fulfilments' ? 'Pharmacy fulfilment' : 'Refill requests'}
          </button>
        ))}
      </div>

      <FilterBar>
        {view === 'prescriptions' && (
          <>
            <div style={{ minWidth: 200 }}>
              <label style={label()}>Search</label>
              <input style={input()} placeholder="Ref, doctor, diagnosis or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
            </div>
            <div style={{ minWidth: 240 }}>
              <label style={label()}>Doctor id</label>
              <input style={input()} placeholder="doctor uuid" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} />
            </div>
            <div><label style={label()}>From</label><input type="date" style={input()} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label style={label()}>To</label><input type="date" style={input()} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div>
              <label style={label()}>Flagged</label>
              <select style={select()} value={flagged} onChange={(e) => setFlagged(e.target.value)}>
                <option value="">All</option><option value="true">Flagged only</option><option value="false">Not flagged</option>
              </select>
            </div>
          </>
        )}
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="">All</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={apply}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={total === 0} emptyText="Nothing matches these filters.">
          {view === 'prescriptions' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Prescription</th><th style={th()}>Doctor</th><th style={th()}>Patient</th><th style={th()}>Diagnosis</th>
                <th style={th()}>Items</th><th style={th()}>Status</th><th style={th()}>Issued</th><th style={th()} />
              </tr></thead>
              <tbody>
                {rx.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}>
                      <code style={{ fontSize: '0.78rem' }}>{r.ref || r.id.slice(0, 8)}</code>
                      {r.source === 'telemedicine' && <div style={{ fontSize: '0.7rem', color: colors.muted }}>booking prescription</div>}
                    </td>
                    <td style={td()}>{r.doctor_name || '—'}</td>
                    <td style={td()}>{r.patient_masked}</td>
                    <td style={td()}>{r.diagnosis || '—'}</td>
                    <td style={td()}>{r.item_count}</td>
                    <td style={td()}><Badge status={r.status} />{r.flagged && <> <Badge status="flagged" /></>}</td>
                    <td style={td()}>{r.issued_at ? fmtDate(r.issued_at) : '—'}</td>
                    <td style={td()}><button style={btn()} onClick={() => setOpenId(r.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'fulfilments' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Prescription</th><th style={th()}>Pharmacy</th><th style={th()}>Status</th><th style={th()}>Delivery</th>
                <th style={th()}>Total</th><th style={th()}>Substitutions</th><th style={th()}>Created</th><th style={th()} />
              </tr></thead>
              <tbody>
                {ful.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.prescription_ref || '—'}</code></td>
                    <td style={td()}>{r.pharmacy_name || '—'}</td>
                    <td style={td()}><Badge status={r.status} /></td>
                    <td style={td()}>{r.delivery_status ? <Badge status={r.delivery_status} /> : '—'}</td>
                    <td style={td()}>{formatNaira(r.total_kobo)}</td>
                    <td style={td()}>{r.pending_substitutions > 0 ? <Badge status="pending" label={`${r.pending_substitutions} to review`} /> : '—'}</td>
                    <td style={td()}>{timeAgo(r.created_at)}</td>
                    <td style={td()}>{r.prescription_id && <button style={btn()} onClick={() => setOpenId(r.prescription_id)}>Open</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'refills' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Prescription</th><th style={th()}>Doctor</th><th style={th()}>Patient</th><th style={th()}>Status</th>
                <th style={th()}>Requested</th><th style={th()}>Reviewed</th><th style={th()} />
              </tr></thead>
              <tbody>
                {ref.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.prescription_ref || '—'}</code></td>
                    <td style={td()}>{r.doctor_name || '—'}</td>
                    <td style={td()}>{r.patient_masked}</td>
                    <td style={td()}><Badge status={r.status} /></td>
                    <td style={td()}>{timeAgo(r.created_at)}</td>
                    <td style={td()}>{r.reviewed_at ? timeAgo(r.reviewed_at) : '—'}</td>
                    <td style={td()}>{r.prescription_id && <button style={btn()} onClick={() => setOpenId(r.prescription_id)}>Open</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem', color: colors.muted }}>
            <span>{total === 0 ? '' : `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total.toLocaleString('en-NG')}`}</span>
            <span style={{ display: 'flex', gap: '0.4rem' }}>
              <button style={btn()} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button style={btn()} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </span>
          </div>
        </StateBlock>
      </Card>

      {openId && <DetailDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => { void loadSummary(); void load(); }} />}
    </div>
  );
}

function DetailDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<RxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setD(await getPrescription(id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function toggleFlag() {
    if (!d) return;
    setBusy(true); setError(null);
    try {
      if (d.flagged) await unflagPrescription(d.id, reason.trim() || undefined);
      else await flagPrescription(d.id, reason.trim());
      setReason('');
      await load();
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const sectionTitle = { fontSize: '0.8rem', textTransform: 'uppercase' as const, letterSpacing: 0.3, color: colors.muted, fontWeight: 700, margin: '1rem 0 0.4rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 'min(560px, 100%)', background: colors.card, padding: '1.25rem', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Prescription {d?.ref || ''}</h2>
          <button style={btn()} onClick={onClose}>Close</button>
        </div>
        <StateBlock loading={loading} error={error} empty={!d} emptyText="Prescription not found.">
          {d && (
            <>
              <p style={{ margin: '0.5rem 0', fontSize: '0.85rem' }}>
                <Badge status={d.status} />{d.flagged && <> <Badge status="flagged" /></>}{' '}
                <span style={{ color: colors.muted }}>{d.source === 'telemedicine' ? 'Booking prescription' : 'Doctor-issued'}</span>
              </p>
              <div style={{ fontSize: '0.88rem', lineHeight: 1.6 }}>
                <div><strong>Doctor:</strong> {d.doctor_name || '—'}</div>
                <div><strong>Patient:</strong> {String(d.patient?.name ?? d.patient?.full_name ?? '') || d.patient_masked} <code style={{ fontSize: '0.75rem' }}>{d.patient_id}</code></div>
                <div><strong>Diagnosis:</strong> {d.diagnosis || '—'}</div>
                <div><strong>Issued:</strong> {d.issued_at ? fmtDate(d.issued_at) : '—'}</div>
              </div>

              <div style={sectionTitle}>Medication</div>
              {d.items.length === 0 && !d.medications_text ? <p style={{ color: colors.muted }}>No items recorded.</p> : null}
              {d.medications_text ? <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{d.medications_text}{d.instructions ? `\n\n${d.instructions}` : ''}</p> : null}
              {d.items.map((it, i) => (
                <div key={i} style={{ padding: '0.4rem 0', borderTop: `1px solid ${colors.border}` }}>
                  <strong>{it.name}</strong> {it.dosage}
                  <div style={{ fontSize: '0.78rem', color: colors.muted }}>{[it.route, it.frequency, it.duration].filter(Boolean).join(' · ')}{it.notes ? ` — ${it.notes}` : ''}</div>
                </div>
              ))}

              <div style={sectionTitle}>Fulfilment</div>
              {d.fulfilments.length === 0 ? <p style={{ color: colors.muted }}>Not sent to a pharmacy.</p> : d.fulfilments.map((f) => (
                <div key={f.id} style={{ padding: '0.4rem 0', borderTop: `1px solid ${colors.border}` }}>
                  <strong>{f.pharmacy_name || 'Pharmacy'}</strong> <Badge status={f.status} /> {formatNaira(f.total_kobo)}
                  {f.deliveries.map((dl, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: colors.muted }}>
                      Delivery: {dl.status}{dl.courier ? ` · ${dl.courier}` : ''}{dl.tracking_ref ? ` · ${dl.tracking_ref}` : ''}{dl.delivered_at ? ` · delivered ${fmtDate(dl.delivered_at)}` : ''}
                    </div>
                  ))}
                  {f.substitutes.map((s, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: colors.muted }}>
                      Substitution: {s.original_drug} → {s.substitute_drug} ({s.status}, {formatNaira(s.price_kobo)})
                    </div>
                  ))}
                </div>
              ))}

              {d.refills.length > 0 && (
                <>
                  <div style={sectionTitle}>Refill requests</div>
                  {d.refills.map((r) => (
                    <div key={r.id} style={{ fontSize: '0.85rem' }}><Badge status={r.status} /> requested {timeAgo(r.created_at)}</div>
                  ))}
                </>
              )}

              <div style={sectionTitle}>Audit trail</div>
              {d.audit.length === 0 ? <p style={{ color: colors.muted }}>No entries.</p> : d.audit.map((a, i) => (
                <div key={i} style={{ fontSize: '0.82rem', padding: '0.25rem 0', borderTop: `1px solid ${colors.border}` }}>
                  <strong>{a.action.replace(/_/g, ' ')}</strong> · {a.actor} · {timeAgo(a.created_at)}
                  {typeof a.detail?.reason === 'string' && a.detail.reason ? <div style={{ color: colors.muted }}>Reason: {a.detail.reason}</div> : null}
                  {typeof a.detail?.note === 'string' && a.detail.note ? <div style={{ color: colors.muted }}>Note: {a.detail.note}</div> : null}
                </div>
              ))}

              {d.source === 'doctor' ? (
                <div style={{ marginTop: '1.25rem' }}>
                  <label style={label()}>{d.flagged ? 'Note (optional)' : 'Reason for flagging (required, 3–500 characters)'}</label>
                  <input style={input()} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                  <div style={{ marginTop: '0.6rem' }}>
                    <button
                      style={d.flagged ? btn() : btnDanger()}
                      disabled={busy || (!d.flagged && reason.trim().length < 3)}
                      onClick={toggleFlag}
                    >
                      {busy ? 'Saving…' : d.flagged ? 'Clear flag' : 'Flag for review'}
                    </button>
                  </div>
                </div>
              ) : (
                <p style={{ marginTop: '1.25rem', fontSize: '0.8rem', color: colors.muted }}>Booking prescriptions are read-only here.</p>
              )}
            </>
          )}
        </StateBlock>
      </div>
    </div>
  );
}
