'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getDrivers, setDriverVerification } from '@/services/mobilityAdminService';
import type { DriverSummary, DriverVerificationStatus } from '@/types/mobility';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice,
  btn, btnPrimary, btnDisabled, input,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_OPTIONS: Array<DriverVerificationStatus | ''> = ['', 'submitted', 'under_review', 'approved', 'rejected', 'suspended'];

export default function MobilityDriversPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.driversManage);

  const [status, setStatus] = useState<DriverVerificationStatus | ''>('');
  const [rows, setRows] = useState<DriverSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // decision modal state
  const [target, setTarget] = useState<{ driver: DriverSummary; action: 'approved' | 'rejected' | 'suspended' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await getDrivers(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const submitDecision = async () => {
    if (!target) return;
    if (!reason.trim()) { setError('A reason is required for this action.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setDriverVerification(target.driver.id, { status: target.action, reason: reason.trim() });
      setMessage(`${target.driver.name}: ${target.action} (audited).`);
      setTarget(null); setReason('');
      await load();
    } catch (e) { setError(`Action failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const queue = rows.filter((d) => d.verificationStatus === 'submitted' || d.verificationStatus === 'under_review');

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Drivers"
        subtitle="Driver roster and verification / approval queue."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="drivers" />
      <AuditedNotice text="Driver approval, rejection and suspension require the mobility.drivers.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      {/* Verification queue summary */}
      <Card title={`Verification queue (${queue.length})`}>
        {!canManage && <StateNote kind="restricted">You have read-only access — approval actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading queue…</StateNote>
          : queue.length === 0 ? <StateNote kind="empty">No drivers awaiting verification.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>Driver</th><th style={thCell}>Zone</th><th style={thCell}>Categories</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((d) => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}>
                      <Link href={`/admin/mobility/drivers/${d.id}`} style={{ fontWeight: 600 }}>{d.name}</Link>
                      <div style={{ fontSize: '0.72rem', color: colors.muted, fontFamily: 'monospace' }}>{d.id}</div>
                    </td>
                    <td style={tdCell}>{d.zone}</td>
                    <td style={tdCell}>{d.serviceCategories.join(', ')}</td>
                    <td style={tdCell}><Badge status={d.verificationStatus} /></td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button disabled={!canManage} style={canManage ? btnPrimary(colors.success) : btnDisabled()} onClick={() => { setTarget({ driver: d, action: 'approved' }); setReason(''); }}>Approve</button>
                        <button disabled={!canManage} style={canManage ? btnPrimary(colors.danger) : btnDisabled()} onClick={() => { setTarget({ driver: d, action: 'rejected' }); setReason(''); }}>Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* Full roster */}
      <Card
        title="All drivers"
        right={
          <select value={status} onChange={(e) => setStatus(e.target.value as DriverVerificationStatus | '')} style={{ ...input(), width: 'auto' }}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        }
      >
        {loading ? <StateNote kind="loading">Loading drivers…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No drivers match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>Driver</th><th style={thCell}>Status</th><th style={thCell}>Online</th><th style={thCell}>Trips</th><th style={thCell}>Rating</th><th style={thCell}>Cancel %</th><th style={thCell}>Tier</th><th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}>
                      <Link href={`/admin/mobility/drivers/${d.id}`} style={{ fontWeight: 600 }}>{d.name}</Link>
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{d.phone}</div>
                    </td>
                    <td style={tdCell}><Badge status={d.verificationStatus} /></td>
                    <td style={tdCell}>{d.online ? <Badge status="online" label="online" /> : <span style={{ color: colors.muted }}>offline</span>}</td>
                    <td style={tdCell}>{d.completedTrips.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{d.rating ? d.rating.toFixed(1) : '—'}</td>
                    <td style={tdCell}>{d.cancelRate}%</td>
                    <td style={tdCell}><Badge status="active" label={d.commissionTier} /></td>
                    <td style={tdCell}>
                      {d.verificationStatus === 'approved' && (
                        <button disabled={!canManage} style={canManage ? btn() : btnDisabled()} onClick={() => { setTarget({ driver: d, action: 'suspended' }); setReason(''); }}>Suspend</button>
                      )}
                      <Link href={`/admin/mobility/drivers/${d.id}`} style={{ marginLeft: 8, fontSize: '0.8rem' }}>Detail →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* Decision modal */}
      {target && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setTarget(null)}>
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, textTransform: 'capitalize' }}>{target.action} driver</h2>
            <p style={{ fontSize: '0.85rem', color: colors.muted, margin: '0 0 0.75rem' }}>{target.driver.name} ({target.driver.id})</p>
            <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Reason (required — written to audit log)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Documents verified; inspection passed." style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setTarget(null)}>Cancel</button>
              <button style={busy || !reason.trim() ? btnDisabled() : btnPrimary(target.action === 'approved' ? colors.success : colors.danger)} disabled={busy || !reason.trim()} onClick={submitDecision}>
                {busy ? 'Submitting…' : `Confirm ${target.action}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
