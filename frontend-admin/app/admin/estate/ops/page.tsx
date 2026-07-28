'use client';

// A-EST-OV-04 — Platform ops queues (estate.admin.ops).
// Repairs, tasks, meetings and facilities across estates.

import { useCallback, useEffect, useState } from 'react';
import {
  listOversightRepairs, listOversightTasks, listOversightMeetings, listOversightFacilities,
} from '@/services/estateAdminService';
import type { OversightRepair, OversightTask, OversightMeeting, OversightFacility } from '@/types/estateAdmin';
import {
  PageHeader, EstateOversightTabs, Card, Badge, btn, th, td, naira, timeAgo,
  useEstatePermissions, ESTATE_ADMIN_PERMS, Restricted,
} from '../_ui';

export default function OpsOversightPage() {
  const { can } = useEstatePermissions();
  const canView = can(ESTATE_ADMIN_PERMS.ops);

  const [repairs, setRepairs] = useState<OversightRepair[]>([]);
  const [tasks, setTasks] = useState<OversightTask[]>([]);
  const [meetings, setMeetings] = useState<OversightMeeting[]>([]);
  const [facilities, setFacilities] = useState<OversightFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true); setError(null);
    try {
      const [r, t, m, f] = await Promise.all([
        listOversightRepairs(), listOversightTasks(), listOversightMeetings(), listOversightFacilities(),
      ]);
      setRepairs(r); setTasks(t); setMeetings(m); setFacilities(f);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { void load(); }, [load]);

  const fmt = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Ops queues" subtitle="Repairs, tasks, meetings and facilities across estates. Gated on estate.admin.ops." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />
      <EstateOversightTabs active="ops" />
      {!canView ? <Restricted perm="estate.admin.ops" /> : (
        <>
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
          {loading ? <p style={{ color: '#6b7280' }}>Loading ops queues…</p> : (
            <>
              <Card title="Repairs">
                {repairs.length === 0 ? <p style={{ color: '#6b7280' }}>No repair requests.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Category</th><th style={th()}>Description</th><th style={th()}>Urgency</th><th style={th()}>Status</th><th style={th()}>Estimate</th><th style={th()}>When</th></tr></thead>
                    <tbody>
                      {repairs.map((r) => (
                        <tr key={r.id}>
                          <td style={td()}>{r.estateId}</td>
                          <td style={td()}>{r.category}</td>
                          <td style={td()}>{r.description}</td>
                          <td style={td()}><Badge status={r.urgency === 'high' ? 'high' : r.urgency === 'medium' ? 'medium' : 'low'} label={r.urgency} /></td>
                          <td style={td()}><Badge status={r.status === 'completed' ? 'resolved' : r.status === 'reported' ? 'open' : 'pending'} label={r.status} /></td>
                          <td style={td()}>{r.costEstimateKobo != null ? naira(r.costEstimateKobo) : '—'}</td>
                          <td style={td()}>{timeAgo(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Tasks">
                {tasks.length === 0 ? <p style={{ color: '#6b7280' }}>No tasks.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Title</th><th style={th()}>Assignee</th><th style={th()}>Priority</th><th style={th()}>Status</th><th style={th()}>Due</th></tr></thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td style={td()}>{t.estateId}</td>
                          <td style={td()}><strong>{t.title}</strong></td>
                          <td style={td()}>{t.assigneeId ?? 'Unassigned'}</td>
                          <td style={td()}><Badge status={t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : 'low'} label={t.priority} /></td>
                          <td style={td()}><Badge status={t.status === 'done' ? 'resolved' : t.status === 'todo' ? 'open' : 'pending'} label={t.status.replace('_', ' ')} /></td>
                          <td style={td()}>{t.dueDate ? fmt(t.dueDate) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Meetings">
                {meetings.length === 0 ? <p style={{ color: '#6b7280' }}>No meetings.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Title</th><th style={th()}>Mode</th><th style={th()}>Starts</th><th style={th()}>Status</th></tr></thead>
                    <tbody>
                      {meetings.map((m) => (
                        <tr key={m.id}>
                          <td style={td()}>{m.estateId}</td>
                          <td style={td()}><strong>{m.title}</strong></td>
                          <td style={td()}>{m.mode}</td>
                          <td style={td()}>{fmt(m.startsAt)}</td>
                          <td style={td()}><Badge status={m.status === 'ended' ? 'completed' : m.status === 'cancelled' ? 'overdue' : m.status === 'live' ? 'active' : 'scheduled'} label={m.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Facilities">
                {facilities.length === 0 ? <p style={{ color: '#6b7280' }}>No facilities.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Name</th><th style={th()}>Kind</th><th style={th()}>Capacity</th><th style={th()}>Booking fee</th></tr></thead>
                    <tbody>
                      {facilities.map((f) => (
                        <tr key={f.id}>
                          <td style={td()}>{f.estateId}</td>
                          <td style={td()}><strong>{f.name}</strong></td>
                          <td style={td()}>{f.kind}</td>
                          <td style={td()}>{f.capacity ?? '—'}</td>
                          <td style={td()}>{f.feeKobo > 0 ? naira(f.feeKobo) : 'Free'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
