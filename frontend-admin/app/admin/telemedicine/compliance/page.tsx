'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getComplianceSummary, suspendClinician, reinstateClinician, type ComplianceSummary,
} from '@/services/telemedAdminComplianceService';
import { PageHeader, TelemedTabs, Card, Kpi, DisclosureNote, btn, btnDanger, btnPrimary, input, label } from '../_ui';
import {
  LicenceTab, SuspendedTab, AuditTab, TrainingTab, QualityTab, AccessLogTab, type ClinicianAction,
} from './_tabs';

type TabKey = 'licences' | 'suspended' | 'audit' | 'training' | 'quality' | 'access';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'licences', label: 'Licence expiry' },
  { key: 'suspended', label: 'Suspended clinicians' },
  { key: 'audit', label: 'Audit log' },
  { key: 'training', label: 'Training' },
  { key: 'quality', label: 'Quality scores' },
  { key: 'access', label: 'Access logs' },
];

const n = (v: number | undefined) => (v ?? 0).toLocaleString('en-NG');

export default function TelemedCompliancePage() {
  const [tab, setTab] = useState<TabKey>('licences');
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [action, setAction] = useState<ClinicianAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try { setSummary(await getComplianceSummary()); }
    catch (e) { setSummaryError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary, refreshKey]);

  function openAction(a: ClinicianAction) {
    setAction(a); setReason(''); setActionError(null); setNotice(null);
  }

  async function confirm() {
    if (!action) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) { setActionError('Enter a reason of at least 5 characters — it is recorded in the audit log.'); return; }
    setBusy(true); setActionError(null);
    try {
      if (action.kind === 'suspend') await suspendClinician(action.userId, trimmed);
      else await reinstateClinician(action.userId, trimmed);
      setNotice(`${action.name || 'Clinician'} ${action.kind === 'suspend' ? 'suspended' : 'reinstated'}.`);
      setAction(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const suspending = action?.kind === 'suspend';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Clinician compliance"
        subtitle="Licence expiry, suspensions, mandatory training and audit trails for telemedicine clinicians."
        action={<button style={btn()} onClick={() => { setRefreshKey((k) => k + 1); }}>Refresh</button>}
      />
      <TelemedTabs active="compliance" />

      <DisclosureNote>
        Suspending a clinician de-lists them from patient search, blocks new bookings and takes them offline;
        they cannot switch availability back on while suspended. Reinstating is refused while their licence is expired.
        Every change is recorded in the audit log with your account and reason.
      </DisclosureNote>

      {notice ? <p style={{ color: '#15803d', fontSize: '0.85rem' }}>{notice}</p> : null}
      {summaryError ? <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>Could not load the summary: {summaryError}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Licences expired" value={n(summary?.licences_expired)} accent={summary && summary.licences_expired > 0 ? '#b91c1c' : undefined} sub="approved, still listed" />
        <Kpi label="Expiring ≤ 30 days" value={n(summary?.licences_expiring_30d)} accent={summary && summary.licences_expiring_30d > 0 ? '#9a3412' : undefined} />
        <Kpi label="Expiring 31–90 days" value={n(summary?.licences_expiring_90d)} />
        <Kpi label="Suspended" value={n(summary?.suspended)} />
        <Kpi label="Training not completed" value={n(summary?.training_pending)} sub={`${n(summary?.training_completed)} completed`} />
        <Kpi label="Audit events (7d)" value={n(summary?.audit_events_7d)} />
      </div>

      {action ? (
        <Card title={suspending ? `Suspend ${action.name || 'clinician'}` : `Reinstate ${action.name || 'clinician'}`}>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: '#374151' }}>
            {suspending
              ? 'The clinician will be removed from patient search and unable to take bookings immediately. Existing appointments are not cancelled.'
              : 'The clinician’s profile is re-approved and published. They must switch availability on themselves.'}
          </p>
          <label style={label()} htmlFor="compliance-reason">Reason (recorded in the audit log)</label>
          <textarea
            id="compliance-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            style={{ ...input(), resize: 'vertical', fontFamily: 'inherit' }} autoFocus
          />
          {actionError ? <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '0.4rem 0 0' }}>{actionError}</p> : null}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button style={suspending ? btnDanger() : btnPrimary()} disabled={busy} onClick={confirm}>
              {busy ? 'Working…' : suspending ? 'Confirm suspension' : 'Confirm reinstatement'}
            </button>
            <button style={btn()} disabled={busy} onClick={() => setAction(null)}>Cancel</button>
          </div>
        </Card>
      ) : null}

      <div role="tablist" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <button
            key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            style={{ ...btn(), fontWeight: 600, ...(tab === t.key ? { background: '#340075', color: '#fff', border: '1px solid #340075' } : {}) }}
          >
            {t.label}{t.key === 'suspended' && summary ? ` (${summary.suspended})` : ''}
          </button>
        ))}
      </div>

      <Card>
        {tab === 'licences' && <LicenceTab refreshKey={refreshKey} onAction={openAction} />}
        {tab === 'suspended' && <SuspendedTab refreshKey={refreshKey} onAction={openAction} />}
        {tab === 'audit' && <AuditTab refreshKey={refreshKey} />}
        {tab === 'training' && <TrainingTab refreshKey={refreshKey} />}
        {tab === 'quality' && <QualityTab refreshKey={refreshKey} />}
        {tab === 'access' && <AccessLogTab refreshKey={refreshKey} />}
      </Card>
    </div>
  );
}
