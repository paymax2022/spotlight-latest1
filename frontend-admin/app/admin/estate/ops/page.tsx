'use client';

// A-EST-OV-04 — Platform ops queues (estate.admin.ops).
// Repairs, tasks, meetings and facilities across estates.

import { useCallback, useEffect, useState } from 'react';
import {
  listOversightRepairs, listOversightTasks, listOversightMeetings, listOversightFacilities,
} from '@/services/estateAdminService';
import type { OversightRepair, OversightTask, OversightMeeting, OversightFacility } from '@/types/estateAdmin';
import { EstateOversightTabs, Restricted, useEstatePermissions, ESTATE_ADMIN_PERMS, naira, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

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
    <Page>
      <PageHeader title="Ops queues" subtitle="Repairs, tasks, meetings and facilities across estates. Gated on estate.admin.ops." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />
      <EstateOversightTabs active="ops" />
      {!canView ? <Restricted perm="estate.admin.ops" /> : (
        <>
          {error && <p style={{ color: colors.danger }}>{error}</p>}
          {loading ? <p style={{ color: colors.muted }}>Loading ops queues…</p> : (
            <>
              <Card title="Repairs" style={{ marginBottom: '1.25rem' }}>
                {repairs.length === 0 ? <p style={{ color: colors.muted }}>No repair requests.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Category</th><th style={thCell}>Description</th><th style={thCell}>Urgency</th><th style={thCell}>Status</th><th style={thCell}>Estimate</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {repairs.map((r) => (
                        <tr key={r.id}>
                          <td style={tdCell}>{r.estateId}</td>
                          <td style={tdCell}>{r.category}</td>
                          <td style={tdCell}>{r.description}</td>
                          <td style={tdCell}><Badge text={cap(r.urgency)} color={r.urgency === 'high' ? colors.danger : r.urgency === 'medium' ? colors.warning : colors.info} /></td>
                          <td style={tdCell}><Badge text={cap(r.status)} color={r.status === 'completed' ? colors.success : r.status === 'reported' ? colors.danger : colors.warning} /></td>
                          <td style={tdCell}>{r.costEstimateKobo != null ? naira(r.costEstimateKobo) : '—'}</td>
                          <td style={tdCell}>{timeAgo(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Tasks" style={{ marginBottom: '1.25rem' }}>
                {tasks.length === 0 ? <p style={{ color: colors.muted }}>No tasks.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Title</th><th style={thCell}>Assignee</th><th style={thCell}>Priority</th><th style={thCell}>Status</th><th style={thCell}>Due</th></tr></thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td style={tdCell}>{t.estateId}</td>
                          <td style={tdCell}><strong>{t.title}</strong></td>
                          <td style={tdCell}>{t.assigneeId ?? 'Unassigned'}</td>
                          <td style={tdCell}><Badge text={cap(t.priority)} color={t.priority === 'high' ? colors.danger : t.priority === 'medium' ? colors.warning : colors.info} /></td>
                          <td style={tdCell}><Badge text={cap(t.status.replace('_', ' '))} color={t.status === 'done' ? colors.success : t.status === 'todo' ? colors.danger : colors.warning} /></td>
                          <td style={tdCell}>{t.dueDate ? fmt(t.dueDate) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Meetings" style={{ marginBottom: '1.25rem' }}>
                {meetings.length === 0 ? <p style={{ color: colors.muted }}>No meetings.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Title</th><th style={thCell}>Mode</th><th style={thCell}>Starts</th><th style={thCell}>Status</th></tr></thead>
                    <tbody>
                      {meetings.map((m) => (
                        <tr key={m.id}>
                          <td style={tdCell}>{m.estateId}</td>
                          <td style={tdCell}><strong>{m.title}</strong></td>
                          <td style={tdCell}>{m.mode}</td>
                          <td style={tdCell}>{fmt(m.startsAt)}</td>
                          <td style={tdCell}><Badge text={cap(m.status)} color={m.status === 'ended' ? colors.success : m.status === 'cancelled' ? colors.danger : m.status === 'live' ? colors.info : colors.warning} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Facilities">
                {facilities.length === 0 ? <p style={{ color: colors.muted }}>No facilities.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Name</th><th style={thCell}>Kind</th><th style={thCell}>Capacity</th><th style={thCell}>Booking fee</th></tr></thead>
                    <tbody>
                      {facilities.map((f) => (
                        <tr key={f.id}>
                          <td style={tdCell}>{f.estateId}</td>
                          <td style={tdCell}><strong>{f.name}</strong></td>
                          <td style={tdCell}>{f.kind}</td>
                          <td style={tdCell}>{f.capacity ?? '—'}</td>
                          <td style={tdCell}>{f.feeKobo > 0 ? naira(f.feeKobo) : 'Free'}</td>
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
    </Page>
  );
}
