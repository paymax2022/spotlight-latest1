'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getDriver, setDriverVerification } from '@/services/mobilityAdminService';
import type { DriverDetail } from '@/types/mobility';
import {
  Card, Badge, StateNote, AuditedNotice,
  btn, btnPrimary, btnDisabled, th, td, input, card, naira,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../../_ui';

export default function MobilityDriverDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.driversManage);

  const [driver, setDriver] = useState<DriverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState<'approved' | 'rejected' | 'suspended' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setDriver(await getDriver(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!action) return;
    if (!reason.trim()) { setError('A reason is required.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setDriverVerification(id, { status: action, reason: reason.trim() });
      setMessage(`${action} succeeded (audited).`);
      setAction(null); setReason('');
      await load();
    } catch (e) { setError(`Action failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: '0.5rem' }}><StateNote kind="loading">Loading driver…</StateNote></div>;
  if (error && !driver) return <div style={{ padding: '0.5rem' }}><p><Link href="/admin/mobility/drivers">← Back to drivers</Link></p><StateNote kind="error">{error}</StateNote></div>;
  if (!driver) return <div style={{ padding: '0.5rem' }}><StateNote kind="empty">Driver not found.</StateNote></div>;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <p><Link href="/admin/mobility/drivers">← Back to drivers</Link></p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{driver.name}</h1>
        <Badge status={driver.verificationStatus} />
        {driver.online ? <Badge status="online" label="online" /> : null}
      </div>
      <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 1rem' }}>
        {driver.phone} · {driver.email} · {driver.zone} · tier {driver.commissionTier} · joined {new Date(driver.createdAt).toLocaleDateString()}
      </p>

      <AuditedNotice text="Verification decisions on this driver require the mobility.drivers.manage role." />
      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.25rem' }}>
        <div>
          <Card title="Documents">
            {driver.documents.length === 0 ? <StateNote kind="empty">No documents uploaded.</StateNote> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={th()}>Document</th><th style={th()}>Status</th><th style={th()}>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {driver.documents.map((d) => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}>{d.label}</td>
                      <td style={td()}><Badge status={d.status} /></td>
                      <td style={td()}>{d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Vehicle">
            {!driver.vehicle ? <StateNote kind="empty">No vehicle on file.</StateNote> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <tbody>
                  {[
                    ['Plate', driver.vehicle.plateNumber],
                    ['Vehicle', `${driver.vehicle.make} ${driver.vehicle.model} (${driver.vehicle.year}) · ${driver.vehicle.color}`],
                    ['Category', `${driver.vehicle.category} · ${driver.vehicle.capacity} seats`],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ ...td(), color: '#6b7280', width: '35%' }}>{k}</td><td style={td()}>{v}</td>
                    </tr>
                  ))}
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td(), color: '#6b7280' }}>Status</td><td style={td()}><Badge status={driver.vehicle.status} /></td></tr>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td(), color: '#6b7280' }}>Inspection</td><td style={td()}><Badge status={driver.vehicle.inspectionStatus} /></td></tr>
                  <tr><td style={{ ...td(), color: '#6b7280' }}>Insurance</td><td style={td()}><Badge status={driver.vehicle.insuranceStatus} /></td></tr>
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div>
          <Card title="Performance & earnings">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td(), color: '#6b7280' }}>Completed trips</td><td style={td()}>{driver.completedTrips.toLocaleString('en-NG')}</td></tr>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td(), color: '#6b7280' }}>Rating</td><td style={td()}>{driver.rating ? driver.rating.toFixed(1) : '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td(), color: '#6b7280' }}>Cancel rate</td><td style={td()}>{driver.cancelRate}%</td></tr>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td(), color: '#6b7280' }}>Gross earnings</td><td style={td()}>{naira(driver.grossEarningsKobo)}</td></tr>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td(), color: '#6b7280' }}>Platform fee</td><td style={td()}>{naira(driver.platformFeeKobo)}</td></tr>
                <tr><td style={{ ...td(), color: '#6b7280' }}>Net earnings</td><td style={td()}><strong>{naira(driver.netEarningsKobo)}</strong></td></tr>
              </tbody>
            </table>
            {driver.notes && <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#9a3412', background: '#ffedd5', padding: '0.5rem', borderRadius: '0.375rem' }}>{driver.notes}</p>}
          </Card>

          <div style={{ ...card() }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Verification decision</h2>
            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot change verification.</StateNote>
            ) : !action ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {driver.verificationStatus !== 'approved' && <button style={btnPrimary('#16a34a')} onClick={() => { setAction('approved'); setReason(''); }}>Approve</button>}
                {driver.verificationStatus !== 'rejected' && <button style={btnPrimary('#dc2626')} onClick={() => { setAction('rejected'); setReason(''); }}>Reject</button>}
                {driver.verificationStatus !== 'suspended' && <button style={btn()} onClick={() => { setAction('suspended'); setReason(''); }}>Suspend</button>}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'capitalize' }}>{action} — reason (required)</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ ...input(), fontFamily: 'inherit' }} placeholder="Reason for the audit log" />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button style={btn()} disabled={busy} onClick={() => setAction(null)}>Cancel</button>
                  <button style={busy || !reason.trim() ? btnDisabled() : btnPrimary()} disabled={busy || !reason.trim()} onClick={submit}>{busy ? 'Submitting…' : 'Confirm'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
