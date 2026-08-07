'use client';

import { useCallback, useEffect, useState } from 'react';
import { getVehicles, setVehicleStatus } from '@/services/mobilityAdminService';
import type { VehicleComplianceRow, VehicleStatus, ComplianceStatus } from '@/types/mobility';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice,
  btn, btnPrimary, btnDisabled, input,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_FILTER: Array<VehicleStatus | ''> = ['', 'active', 'inactive', 'suspended'];
const VEHICLE_STATUSES: VehicleStatus[] = ['active', 'inactive', 'suspended'];
const COMPLIANCE: ComplianceStatus[] = ['valid', 'pending', 'expired', 'failed'];

export default function MobilityVehiclesPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.vehiclesManage);

  const [filter, setFilter] = useState<VehicleStatus | ''>('');
  const [rows, setRows] = useState<VehicleComplianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [edit, setEdit] = useState<VehicleComplianceRow | null>(null);
  const [form, setForm] = useState<{ status: VehicleStatus; inspectionStatus: ComplianceStatus; insuranceStatus: ComplianceStatus; reason: string }>({ status: 'active', inspectionStatus: 'valid', insuranceStatus: 'valid', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await getVehicles(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const openEdit = (v: VehicleComplianceRow) => {
    setEdit(v);
    setForm({ status: v.status, inspectionStatus: v.inspectionStatus, insuranceStatus: v.insuranceStatus, reason: '' });
  };

  const submit = async () => {
    if (!edit) return;
    if (!form.reason.trim()) { setError('A reason is required (audited).'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setVehicleStatus(edit.id, { status: form.status, inspectionStatus: form.inspectionStatus, insuranceStatus: form.insuranceStatus, reason: form.reason.trim() });
      setMessage(`Vehicle ${edit.plateNumber} updated (audited).`);
      setEdit(null);
      await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Vehicle Compliance"
        subtitle="Vehicle status, inspection and insurance compliance."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="vehicles" />
      <AuditedNotice text="Changing vehicle status, inspection or insurance requires the mobility.vehicles.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <Card
        title="Vehicles"
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value as VehicleStatus | '')} style={{ ...input(), width: 'auto' }}>
            {STATUS_FILTER.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        }
      >
        {loading ? <StateNote kind="loading">Loading vehicles…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No vehicles match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>Plate</th><th style={thCell}>Vehicle</th><th style={thCell}>Driver</th><th style={thCell}>Status</th><th style={thCell}>Inspection</th><th style={thCell}>Insurance</th><th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><strong>{v.plateNumber}</strong></td>
                    <td style={tdCell}>{v.make} {v.model} ({v.year}) · {v.category}</td>
                    <td style={tdCell}>{v.driverName}</td>
                    <td style={tdCell}><Badge status={v.status} /></td>
                    <td style={tdCell}><Badge status={v.inspectionStatus} />{v.inspectionExpiry ? <div style={{ fontSize: '0.7rem', color: colors.muted }}>{new Date(v.inspectionExpiry).toLocaleDateString()}</div> : null}</td>
                    <td style={tdCell}><Badge status={v.insuranceStatus} />{v.insuranceExpiry ? <div style={{ fontSize: '0.7rem', color: colors.muted }}>{new Date(v.insuranceExpiry).toLocaleDateString()}</div> : null}</td>
                    <td style={tdCell}><button disabled={!canManage} style={canManage ? btn() : btnDisabled()} onClick={() => openEdit(v)}>Update</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {!canManage && <StateNote kind="restricted">Read-only — your role cannot change compliance status.</StateNote>}
      </Card>

      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setEdit(null)}>
          <div style={{ background: colors.card, borderRadius: '0.5rem', padding: '1.25rem', width: 'min(460px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', fontWeight: 700 }}>Update {edit.plateNumber}</h2>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Vehicle status
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as VehicleStatus }))} style={{ ...input(), marginTop: 4 }}>
                  {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Inspection status
                <select value={form.inspectionStatus} onChange={(e) => setForm((f) => ({ ...f, inspectionStatus: e.target.value as ComplianceStatus }))} style={{ ...input(), marginTop: 4 }}>
                  {COMPLIANCE.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Insurance status
                <select value={form.insuranceStatus} onChange={(e) => setForm((f) => ({ ...f, insuranceStatus: e.target.value as ComplianceStatus }))} style={{ ...input(), marginTop: 4 }}>
                  {COMPLIANCE.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Reason (required — audited)
                <textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={2} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
              <button style={busy || !form.reason.trim() ? btnDisabled() : btnPrimary()} disabled={busy || !form.reason.trim()} onClick={submit}>{busy ? 'Saving…' : 'Save (audited)'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
