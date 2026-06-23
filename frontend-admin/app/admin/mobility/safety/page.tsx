'use client';

import { useCallback, useEffect, useState } from 'react';
import { getIncidents, updateIncident } from '@/services/mobilityAdminService';
import type { SafetyIncidentRow, IncidentStatus } from '@/types/mobility';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, th, td, input,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';

const STATUS_FILTER: Array<IncidentStatus | ''> = ['', 'open', 'investigating', 'resolved', 'escalated'];
const STATUS_OPTIONS: IncidentStatus[] = ['open', 'investigating', 'resolved', 'escalated'];

export default function MobilitySafetyPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.safetyManage);

  const [filter, setFilter] = useState<IncidentStatus | ''>('');
  const [rows, setRows] = useState<SafetyIncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [selected, setSelected] = useState<SafetyIncidentRow | null>(null);
  const [form, setForm] = useState<{ status: IncidentStatus; assignedAdmin: string; resolutionNote: string }>({ status: 'open', assignedAdmin: '', resolutionNote: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await getIncidents(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = (i: SafetyIncidentRow) => {
    setSelected(i);
    setForm({ status: i.status, assignedAdmin: i.assignedAdmin ?? '', resolutionNote: i.resolutionNote ?? '' });
  };

  const submit = async () => {
    if (!selected) return;
    if (form.status === 'resolved' && !form.resolutionNote.trim()) { setError('A resolution note is required to resolve an incident.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await updateIncident(selected.id, { status: form.status, assignedAdmin: form.assignedAdmin || undefined, resolutionNote: form.resolutionNote || undefined });
      setMessage(`Incident ${selected.id} updated (audited).`);
      setSelected(null);
      await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const openCount = rows.filter((i) => i.status === 'open').length;
  const criticalCount = rows.filter((i) => i.severity === 'critical').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Safety Center"
        subtitle="SOS, route deviation, unexpected stops and reported incidents."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="safety" />
      <AuditedNotice text="Assigning and resolving safety incidents requires the mobility.safety.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total incidents" value={String(rows.length)} />
        <Kpi label="Open" value={String(openCount)} accent={openCount ? '#dc2626' : '#16a34a'} />
        <Kpi label="Critical" value={String(criticalCount)} accent={criticalCount ? '#dc2626' : '#6b7280'} />
      </div>

      <Card
        title="Incidents"
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value as IncidentStatus | '')} style={{ ...input(), width: 'auto' }}>
            {STATUS_FILTER.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        }
      >
        {loading ? <StateNote kind="loading">Loading incidents…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No incidents match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={th()}>Incident</th><th style={th()}>Type</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}>Trip / Parties</th><th style={th()}>Assigned</th><th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} style={{ borderBottom: '1px solid #f3f4f6', background: i.severity === 'critical' && i.status === 'open' ? '#fef2f2' : undefined }}>
                    <td style={td()}><strong>{i.id}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{new Date(i.createdAt).toLocaleString()}</div></td>
                    <td style={td()}><Badge status={i.type} /></td>
                    <td style={td()}><Badge status={i.severity} /></td>
                    <td style={td()}><Badge status={i.status} /></td>
                    <td style={td()}>{i.tripId ?? '—'}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{i.riderName}{i.driverName ? ` ↔ ${i.driverName}` : ''}</div></td>
                    <td style={td()}>{i.assignedAdmin ?? <span style={{ color: '#9ca3af' }}>unassigned</span>}</td>
                    <td style={td()}><button style={btn()} onClick={() => openDetail(i)}>{canManage ? 'Manage' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setSelected(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(520px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{selected.id}</h2>
              <Badge status={selected.type} /><Badge status={selected.severity} />
            </div>
            <p style={{ fontSize: '0.85rem', color: '#374151', margin: '0 0 0.5rem' }}>{selected.description}</p>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 1rem' }}>
              {selected.riderName}{selected.driverName ? ` ↔ ${selected.driverName}` : ''} · {selected.zone}
              {selected.lat != null && selected.lng != null ? ` · ${selected.lat.toFixed(4)}, ${selected.lng.toFixed(4)}` : ''}
            </p>

            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot update safety incidents.</StateNote>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Status
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as IncidentStatus }))} style={{ ...input(), marginTop: 4 }}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Assign admin
                  <input value={form.assignedAdmin} onChange={(e) => setForm((f) => ({ ...f, assignedAdmin: e.target.value }))} placeholder="Admin name / ID" style={{ ...input(), marginTop: 4 }} />
                </label>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Resolution note {form.status === 'resolved' ? '(required)' : '(optional)'}
                  <textarea value={form.resolutionNote} onChange={(e) => setForm((f) => ({ ...f, resolutionNote: e.target.value }))} rows={3} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
                </label>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setSelected(null)}>Close</button>
              {canManage && <button style={busy ? btnDisabled() : btnPrimary()} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save (audited)'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
