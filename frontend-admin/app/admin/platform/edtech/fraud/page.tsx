'use client';

// SU-04 — Fraud & Risk Queue. Anomalous payment patterns, disputed promotions,
// chargeback review across all schools. RBAC: platform_edtech_admin.

import { useEffect, useState } from 'react';
import { listRiskCases, actionRiskCase } from '@/services/platformEdtechAdminService';
import type { RiskCase, RiskStatus } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, formatNaira, timeAgo,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote, btn, btnPrimary, th, td, input, select, label,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

const KIND_LABEL: Record<string, string> = { anomalous_payment: 'Anomalous payment', disputed_promotion: 'Disputed promotion', chargeback: 'Chargeback' };

export default function FraudRiskPage() {
  const [cases, setCases] = useState<RiskCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { status: RiskStatus; note: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setCases(await listRiskCases()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function f(id: string) { return form[id] ?? { status: 'investigating' as RiskStatus, note: '' }; }

  async function apply(c: RiskCase) {
    const cur = f(c.id);
    if (!cur.note.trim()) { setNotice('A note is required — risk actions are audited.'); return; }
    setBusy(c.id); setNotice(null);
    try { const u = await actionRiskCase({ id: c.id, status: cur.status, note: cur.note }); setNotice(`Case ${c.id} → ${u.status}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const open = cases.filter((c) => c.status === 'open' || c.status === 'investigating');

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Fraud & Risk Queue" subtitle="Anomalous payments, disputed promotions and chargebacks flagged across every school. Triage, investigate, action or dismiss." action={<button onClick={load} style={btn()}>Refresh</button>} />
        <PlatformTabs active="fraud" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. Disputed-promotion cases must respect SF-3 (two approvals) — a promotion recorded without a second approval is itself a defect, not a valid state.</DisclosureNote>
        {notice ? <div style={{ marginBottom: '1rem', color: colors.primary }}>{notice}</div> : null}

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Open / investigating" value={open.length.toString()} accent={open.length ? colors.danger : colors.success} />
            <Kpi label="Critical" value={cases.filter((c) => c.severity === 'critical' && (c.status === 'open' || c.status === 'investigating')).length.toString()} accent={colors.danger} />
            <Kpi label="Amount at risk" value={formatNaira(open.reduce((s, c) => s + (c.amount_kobo ?? 0), 0))} accent={colors.warning} />
          </div>

          {cases.map((c) => (
            <Card key={c.id} title={`${KIND_LABEL[c.kind]} — ${c.school_name}`} right={<span style={{ display: 'flex', gap: '0.4rem' }}><Badge status={c.severity} /><Badge status={c.status} /></span>}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', color: colors.text }}>{c.summary}</p>
              <div style={{ fontSize: '0.78rem', color: colors.muted }}>{c.amount_kobo ? `${formatNaira(c.amount_kobo)} · ` : ''}opened {timeAgo(c.opened_at)} · {c.id}</div>
              {c.status !== 'actioned' && c.status !== 'dismissed' ? (
                <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '0.75rem', paddingTop: '0.75rem', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.6rem', alignItems: 'end' }}>
                  <div><span style={label()}>Set status</span>
                    <select style={select()} value={f(c.id).status} onChange={(e) => setForm({ ...form, [c.id]: { ...f(c.id), status: e.target.value as RiskStatus } })}>
                      <option value="investigating">Investigating</option><option value="actioned">Actioned</option><option value="dismissed">Dismissed</option>
                    </select>
                  </div>
                  <div><span style={label()}>Note (required, audited)</span><input style={input()} value={f(c.id).note} onChange={(e) => setForm({ ...form, [c.id]: { ...f(c.id), note: e.target.value } })} /></div>
                  <button onClick={() => apply(c)} disabled={busy === c.id} style={btnPrimary()}>Apply</button>
                </div>
              ) : null}
              <AuditNote>Every status change is written to the immutable audit trail.</AuditNote>
            </Card>
          ))}
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
