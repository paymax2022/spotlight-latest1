'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listReassignments, decideReassignment } from '@/services/referralAdminService';
import type { Reassignment } from '@/types/referralAdmin';
import { ReferralTabs, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'pending', 'approved', 'rejected'];
const REASON_LABEL: Record<Reassignment['reason'], string> = {
  late_claim: 'Late code claim', fraud_correction: 'Fraud correction', dispute: 'Dispute',
};

function statusColor(status: string): string {
  if (status === 'approved') return colors.success;
  if (status === 'rejected') return colors.danger;
  return colors.warning;
}

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
    <Page>
      <PageHeader
        title="Attribution reassignment & disputes"
        subtitle="A-USR-06 / §7A.5 — reassign attribution (late claim / fraud / dispute), reverse prior accrual incl. house, with separation-of-duties co-sign for house-benefiting changes and a full audit trail."
        actions={<Link href="/admin/referral/attribution"><Button variant="outline">← Attribution config</Button></Link>}
      />
      <ReferralTabs active="attribution" />

      <Card style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ marginLeft: 'auto' }}><Button variant="outline" sm onClick={load}>Refresh</Button></span>
        </label>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text, padding: '14px 14px 0' }}>Reassignment queue</h2>
        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, fontSize: 13, padding: 14 }}>{error}</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No reassignments in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead><tr><th style={thCell}>ID</th><th style={thCell}>Referred user</th><th style={thCell}>From → To</th><th style={thCell}>Reason</th><th style={thCell}>Co-sign</th><th style={thCell}>Status</th><th style={thCell}>Raised</th><th style={thCell}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.referred_user_id}</code></td>
                  <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.from_party}</code> → <code style={{ fontSize: '0.76rem' }}>{r.to_party}</code></td>
                  <td style={tdCell}>{REASON_LABEL[r.reason]}</td>
                  <td style={tdCell}>{r.benefits_house ? <Badge text="co-sign required" color={colors.danger} /> : <Badge text="not required" color={colors.secondary} />}</td>
                  <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                  <td style={tdCell}>{timeAgo(r.created_at)}</td>
                  <td style={{ ...tdCell, textAlign: 'right' }}><Button variant="outline" sm onClick={() => setActive(r)}>Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {active && <ReviewPanel item={active} onClose={() => setActive(null)} onDone={() => { setActive(null); load(); }} />}
    </Page>
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

  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' } as const;

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Review {item.id}</h2>
        <Button variant="outline" sm onClick={onClose}>Close</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <Field label="Referred user" value={<code>{item.referred_user_id}</code>} />
        <Field label="From → To" value={<><code>{item.from_party}</code> → <code>{item.to_party}</code></>} />
        <Field label="Reason" value={REASON_LABEL[item.reason]} />
        <Field label="Requested by" value={<code>{item.requested_by}</code>} />
        <Field label="Benefits house" value={item.benefits_house ? 'Yes — co-sign required' : 'No'} />
        <Field label="Status" value={<Badge text={item.status} color={statusColor(item.status)} />} />
      </div>

      {requiresCosign && !decided && (
        <div style={{ border: `1px solid ${tint(colors.warning, 0.4)}`, background: tint(colors.warning, 0.08), borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 700, color: colors.warning, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Separation of duties — Risk/Compliance co-sign</div>
          <p style={{ fontSize: '0.78rem', color: colors.warning, marginTop: 0 }}>
            This reassignment benefits the house account. The Super Admin who owns the house cannot be the sole approver — a different Risk/Compliance officer must co-sign (§7A.5). Requester: <code>{item.requested_by}</code>.
          </p>
          <div style={{ maxWidth: 360 }}>
            <label style={labelStyle}>Co-signer user ID (must differ from requester)</label>
            <Input value={cosignerId} onChange={(e) => setCosignerId(e.target.value)} placeholder="adm_risk / adm_compliance" />
          </div>
        </div>
      )}

      {!decided && (
        <div style={{ marginBottom: '0.75rem', maxWidth: 560 }}>
          <label style={labelStyle}>Decision note (audited)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Valid code claim confirmed within grace window" />
        </div>
      )}

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {!decided ? (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <Button variant="primary" onClick={() => decide('approved')} disabled={busy}>Approve & reassign</Button>
          <Button variant="danger" onClick={() => decide('rejected')} disabled={busy}>Reject</Button>
        </div>
      ) : (
        <p style={{ color: colors.muted, fontSize: '0.85rem' }}>Already {item.status}{item.cosigned_by ? ` (co-signed by ${item.cosigned_by})` : ''}{item.decided_at ? ` · ${timeAgo(item.decided_at)}` : ''}.</p>
      )}

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Audit trail</div>
        {item.audit.length === 0 ? <p style={{ color: colors.muted, fontSize: '0.8rem' }}>No audit entries.</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {item.audit.map((a, i) => (
              <li key={i} style={{ fontSize: '0.8rem', color: colors.text, padding: '0.3rem 0', borderBottom: `1px solid ${colors.border}` }}>
                <strong>{a.actor}</strong> — {a.action} <span style={{ color: colors.muted }}>· {timeAgo(a.ts)}</span>
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
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem', color: colors.text }}>{value}</div>
    </div>
  );
}
