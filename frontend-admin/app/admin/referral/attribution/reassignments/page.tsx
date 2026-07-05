'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listReassignments, decideReassignment } from '@/services/referralAdminService';
import type { Reassignment } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Badge, btn, btnPrimary, btnDanger, input, label, th, td, timeAgo, StateBlock } from '../../_ui';

const STATUSES = ['all', 'pending', 'approved', 'rejected'];
const REASON_LABEL: Record<Reassignment['reason'], string> = {
  late_claim: 'Late code claim', fraud_correction: 'Fraud correction', dispute: 'Dispute',
};

export default function ReassignmentsPage() {
  const [rows, setRows] = useState<Reassignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [active, setActive] = useState<Reassignment | null>(null);

  const filter = useMemo(() => (status === 'all' ? undefined : status), [status]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReassignments(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Attribution reassignment & disputes"
        subtitle="A-USR-06 / §7A.5 — reassign attribution (late claim / fraud / dispute), reverse prior accrual incl. house, with separation-of-duties co-sign for house-benefiting changes and a full audit trail."
        action={<Link href="/admin/referral/attribution" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Attribution config</Link>}
      />
      <ReferralTabs active="attribution" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ marginLeft: 'auto' }}><button onClick={load} style={btn()}>Refresh</button></span>
        </label>
      </Card>

      <Card title="Reassignment queue">
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reassignments in this state.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>ID</th><th style={th()}>Referred user</th><th style={th()}>From → To</th><th style={th()}>Reason</th><th style={th()}>Co-sign</th><th style={th()}>Status</th><th style={th()}>Raised</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.referred_user_id}</code></td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.from_party}</code> → <code style={{ fontSize: '0.76rem' }}>{r.to_party}</code></td>
                  <td style={td()}>{REASON_LABEL[r.reason]}</td>
                  <td style={td()}>{r.benefits_house ? <Badge status="critical" label="co-sign required" /> : <Badge status="low" label="not required" />}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                  <td style={{ ...td(), textAlign: 'right' }}><button onClick={() => setActive(r)} style={btn()}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {active && <ReviewPanel item={active} onClose={() => setActive(null)} onDone={() => { setActive(null); load(); }} />}
    </div>
  );
}

function ReviewPanel({ item, onClose, onDone }: { item: Reassignment; onClose: () => void; onDone: () => void }) {
  const [cosignerId, setCosignerId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Separation of duties (§7A.5): when the change benefits the house, the
  // requester cannot also be the co-signer/approver — Risk/Compliance must co-sign.
  const requiresCosign = item.benefits_house;
  const decided = item.status !== 'pending';

  async function decide(decision: 'approved' | 'rejected') {
    if (decided) return;
    if (decision === 'approved' && requiresCosign) {
      if (!cosignerId.trim()) { setError('A co-signer is required for house-benefiting reassignments.'); return; }
      if (cosignerId.trim() === item.requested_by) { setError('Separation of duties: the co-signer must differ from the requester.'); return; }
    }
    setBusy(true); setError(null);
    try { await decideReassignment({ id: item.id, decision, cosigner_id: cosignerId.trim() || 'self', note: note.trim() }); onDone(); }
    catch (e) { setError(String(e)); setBusy(false); }
  }

  return (
    <Card title={`Review ${item.id}`} right={<button onClick={onClose} style={btn()}>Close</button>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <Field label="Referred user" value={<code>{item.referred_user_id}</code>} />
        <Field label="From → To" value={<><code>{item.from_party}</code> → <code>{item.to_party}</code></>} />
        <Field label="Reason" value={REASON_LABEL[item.reason]} />
        <Field label="Requested by" value={<code>{item.requested_by}</code>} />
        <Field label="Benefits house" value={item.benefits_house ? 'Yes — co-sign required' : 'No'} />
        <Field label="Status" value={<Badge status={item.status} />} />
      </div>

      {requiresCosign && !decided && (
        <div style={{ border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 700, color: '#9a3412', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Separation of duties — Risk/Compliance co-sign</div>
          <p style={{ fontSize: '0.78rem', color: '#9a3412', marginTop: 0 }}>
            This reassignment benefits the house account. The Super Admin who owns the house cannot be the sole approver — a different Risk/Compliance officer must co-sign (§7A.5). Requester: <code>{item.requested_by}</code>.
          </p>
          <div style={{ maxWidth: 360 }}>
            <label style={label()}>Co-signer user ID (must differ from requester)</label>
            <input value={cosignerId} onChange={(e) => setCosignerId(e.target.value)} style={input()} placeholder="adm_risk / adm_compliance" />
          </div>
        </div>
      )}

      {!decided && (
        <div style={{ marginBottom: '0.75rem', maxWidth: 560 }}>
          <label style={label()}>Decision note (audited)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={input()} placeholder="e.g. Valid code claim confirmed within grace window" />
        </div>
      )}

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {!decided ? (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button onClick={() => decide('approved')} disabled={busy} style={{ ...btnPrimary(), opacity: busy ? 0.6 : 1 }}>Approve & reassign</button>
          <button onClick={() => decide('rejected')} disabled={busy} style={btnDanger()}>Reject</button>
        </div>
      ) : (
        <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Already {item.status}{item.cosigned_by ? ` (co-signed by ${item.cosigned_by})` : ''}{item.decided_at ? ` · ${timeAgo(item.decided_at)}` : ''}.</p>
      )}

      <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Audit trail</div>
        {item.audit.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>No audit entries.</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {item.audit.map((a, i) => (
              <li key={i} style={{ fontSize: '0.8rem', color: '#374151', padding: '0.3rem 0', borderBottom: '1px solid #f9fafb' }}>
                <strong>{a.actor}</strong> — {a.action} <span style={{ color: '#9ca3af' }}>· {timeAgo(a.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem', color: '#111827' }}>{value}</div>
    </div>
  );
}
