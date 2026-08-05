'use client';

import { useEffect, useState } from 'react';
import { getScreeningAlerts, setAlertStatus } from '@/services/fxAdminService';
import type { ScreeningAlert, CaseStatus } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, th, td } from '../_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

const SEV_COLOR: Record<string, string> = { high: '#dc2626', medium: '#d97706', low: '#6b7280' };

type Decision = Extract<CaseStatus, 'cleared' | 'blocked' | 'sar_filed'>;

// Confirm config per decision. A SAR is a regulatory filing → critical; every
// decision requires a typed reason for the audit trail. (Maker-checker / dual-
// control is supported by ConfirmDialog + useCriticalAction and should be enabled
// for SAR once the backend approval endpoint exists — see the compliance TODO.)
const DECISION: Record<Decision, { title: string; level: 'critical' | 'warning'; cta: string; reasons: string[] }> = {
  cleared: {
    title: 'Clear screening alert',
    level: 'warning',
    cta: 'Clear alert',
    reasons: ['Marks the alert as cleared and reopens the customer’s FX activity.', 'Recorded in the audit log with your name, reason and timestamp.'],
  },
  blocked: {
    title: 'Block customer',
    level: 'critical',
    cta: 'Block',
    reasons: ['Blocks the customer’s FX activity (a first-class compliance_block outcome).', 'Recorded in the audit log with your name, reason and timestamp.'],
  },
  sar_filed: {
    title: 'File Suspicious Activity Report',
    level: 'critical',
    cta: 'File SAR',
    reasons: [
      'Files a regulatory SAR — this cannot be undone.',
      'Should require a second compliance approver (dual-control) — pending backend support.',
      'Recorded in the audit log with your name, reason and timestamp.',
    ],
  },
};

export default function FxCompliancePage() {
  const [rows, setRows] = useState<ScreeningAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; customer: string; status: Decision } | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await getScreeningAlerts());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function askDecision(id: string, customer: string, status: Decision) {
    setError(null);
    setPending({ id, customer, status });
  }

  async function confirmDecision(reason: string) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await setAlertStatus(pending.id, pending.status, reason);
      setPending(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The decision could not be recorded. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const open = rows.filter((r) => r.status === 'open' || r.status === 'in_review').length;
  const cfg = pending ? DECISION[pending.status] : null;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Compliance & Risk" subtitle={`${open} open · sanctions / AML / monitoring queue`} action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="compliance" />

      <Card title="Screening & monitoring queue">
        {error ? (
          <p role="alert" style={{ color: '#dc2626', fontSize: '0.82rem', margin: '0 0 0.6rem' }}>{error}</p>
        ) : null}
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : rows.length === 0 ? <p style={{ color: '#6b7280' }}>Queue is clear.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Customer</th><th style={th()}>Kind</th><th style={th()}>Detail</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{a.customer}</strong>{a.reference ? <div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{a.reference}</div> : null}</td>
                  <td style={{ ...td(), textTransform: 'uppercase', fontSize: '0.75rem' }}>{a.kind.replace('_', ' ')}</td>
                  <td style={{ ...td(), maxWidth: 280 }}>{a.detail}</td>
                  <td style={{ ...td(), color: SEV_COLOR[a.severity], fontWeight: 600, textTransform: 'capitalize' }}>{a.severity}</td>
                  <td style={td()}><Badge status={a.status} /></td>
                  <td style={{ ...td(), textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.status !== 'cleared' && a.status !== 'blocked' && a.status !== 'sar_filed' ? (
                      <>
                        <button disabled={busy} onClick={() => askDecision(a.id, a.customer, 'cleared')} style={{ ...btnPrimary('#16a34a'), marginRight: 6 }}>Clear</button>
                        <button disabled={busy} onClick={() => askDecision(a.id, a.customer, 'blocked')} style={{ ...btnPrimary('#dc2626'), marginRight: 6 }}>Block</button>
                        <button disabled={busy} onClick={() => askDecision(a.id, a.customer, 'sar_filed')} style={btn()}>File SAR</button>
                      </>
                    ) : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>A <code>compliance_block</code> is a first-class quote/transfer outcome. All decisions are audit-logged with actor and timestamp.</p>
      </Card>

      {pending && cfg ? (
        <ConfirmDialog
          open
          title={cfg.title}
          level={cfg.level}
          description={`${pending.customer} — this decision is recorded with your name, reason and timestamp.`}
          reasons={cfg.reasons}
          requireReason
          reasonPlaceholder="Basis for this decision (e.g. sanctions match reviewed, false positive, STR reference)…"
          busy={busy}
          confirmLabel={cfg.cta}
          onConfirm={confirmDecision}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}
