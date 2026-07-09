'use client';

// SU-02 — School Verification Queue. Review CAC docs + references, approve/reject
// the verified tier. Every decision requires a reason (audited). RBAC: platform_edtech_admin.

import { useEffect, useState } from 'react';
import { listVerificationQueue, reviewVerification } from '@/services/platformEdtechAdminService';
import type { VerificationSubmission, VerificationTier } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, fmtDate,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote, btn, btnPrimary, btnDanger, th, td, input, select, label,
} from '../_ui';

export default function VerificationQueuePage() {
  const [subs, setSubs] = useState<VerificationSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { tier: VerificationTier; reason: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setSubs(await listVerificationQueue()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function f(id: string) { return form[id] ?? { tier: 'verified' as VerificationTier, reason: '' }; }

  async function decide(sub: VerificationSubmission, decision: 'approve' | 'reject') {
    const cur = f(sub.id);
    if (!cur.reason.trim()) { setNotice('A reason is required — every verification decision is audited.'); return; }
    setBusy(sub.id); setNotice(null);
    try {
      const u = await reviewVerification({ id: sub.id, decision, granted_tier: decision === 'approve' ? cur.tier : undefined, reason: cur.reason });
      setNotice(`${sub.school_name} → ${u.status}${decision === 'approve' ? ` (${cur.tier})` : ''}.`);
      await load();
    } catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const pending = subs.filter((s) => s.status === 'pending');

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="School Verification Queue" subtitle="Review CAC registration documents and reference checks, then approve or reject the requested verification tier. Verified+ gates escrow custody, gov-reporting and competition eligibility." action={<button onClick={load} style={btn()}>Refresh</button>} />
        <PlatformTabs active="verification" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. Approving a tier can activate a draft school. Every decision writes an immutable audit event (module <code>academy.fees</code>) with the reviewer and reason.</DisclosureNote>
        {notice ? <div style={{ marginBottom: '1rem', color: '#5b21b6' }}>{notice}</div> : null}

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Pending review" value={pending.length.toString()} accent={pending.length ? '#9a3412' : undefined} />
            <Kpi label="Approved (all time)" value={subs.filter((s) => s.status === 'approved').length.toString()} accent="#15803d" />
            <Kpi label="Rejected (all time)" value={subs.filter((s) => s.status === 'rejected').length.toString()} accent="#b91c1c" />
          </div>

          {subs.map((s) => (
            <Card key={s.id} title={s.school_name} right={<Badge status={s.status} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div><span style={label()}>Requested tier</span><Badge status={s.requested_tier} /></div>
                <div><span style={label()}>CAC number</span><code>{s.cac_number}</code></div>
                <div><span style={label()}>CAC document</span><a href={s.cac_doc_url} style={{ color: '#340075' }}>View document</a></div>
                <div><span style={label()}>Submitted</span>{fmtDate(s.submitted_at)}</div>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <span style={label()}>References</span>
                <ul style={{ margin: '0.25rem 0', paddingLeft: '1.1rem', fontSize: '0.85rem', color: '#374151' }}>
                  {s.references.map((r, i) => <li key={i}>{r.name} — {r.role} ({r.phone})</li>)}
                </ul>
              </div>
              {s.status === 'pending' ? (
                <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '0.75rem', paddingTop: '0.75rem', display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: '0.6rem', alignItems: 'end' }}>
                  <div><span style={label()}>Grant tier</span>
                    <select style={select()} value={f(s.id).tier} onChange={(e) => setForm({ ...form, [s.id]: { ...f(s.id), tier: e.target.value as VerificationTier } })}>
                      <option value="basic">Basic</option><option value="verified">Verified</option><option value="premium">Premium</option>
                    </select>
                  </div>
                  <div><span style={label()}>Reason (required, audited)</span><input style={input()} value={f(s.id).reason} onChange={(e) => setForm({ ...form, [s.id]: { ...f(s.id), reason: e.target.value } })} placeholder="Basis for the decision" /></div>
                  <button onClick={() => decide(s, 'approve')} disabled={busy === s.id} style={btnPrimary()}>Approve</button>
                  <button onClick={() => decide(s, 'reject')} disabled={busy === s.id} style={btnDanger()}>Reject</button>
                </div>
              ) : (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#6b7280' }}>Decided by {s.reviewer} on {fmtDate(s.decided_at)} — {s.reason}</div>
              )}
              <AuditNote>Approve/reject writes an immutable audit event with reviewer + reason.</AuditNote>
            </Card>
          ))}
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
