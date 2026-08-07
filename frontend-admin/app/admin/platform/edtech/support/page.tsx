'use client';

// SU-09 — Support Ticket Queue. Escalations from school admins and parents that
// couldn't be resolved at the school level. RBAC: platform_edtech_admin.

import { useEffect, useMemo, useState } from 'react';
import { listSupportTickets, actionSupportTicket } from '@/services/platformEdtechAdminService';
import type { SupportTicket, TicketStatus } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, timeAgo,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote, btn, btnPrimary, th, td, input, select, label,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function SupportQueuePage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [form, setForm] = useState<Record<string, { status: TicketStatus; note: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setTickets(await listSupportTickets()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function f(id: string) { return form[id] ?? { status: 'in_review' as TicketStatus, note: '' }; }
  const rows = useMemo(() => tickets.filter((t) => !origin || t.origin === origin), [tickets, origin]);

  async function apply(t: SupportTicket) {
    const cur = f(t.id);
    if (!cur.note.trim()) { setNotice('A note is required to update a ticket (audited).'); return; }
    setBusy(t.id); setNotice(null);
    try { const u = await actionSupportTicket({ id: t.id, status: cur.status, note: cur.note }); setNotice(`Ticket ${t.id} → ${u.status}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const open = tickets.filter((t) => t.status === 'open' || t.status === 'escalated');

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Support Ticket Queue" subtitle="Escalations from school admins and parents that couldn't be resolved at the school level. Triage, work and resolve." action={<button onClick={load} style={btn()}>Refresh</button>} />
        <PlatformTabs active="support" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. Hardship/freeze-related escalations must respect SF-9 — they route to human review and are never auto-approved/denied.</DisclosureNote>
        {notice ? <div style={{ marginBottom: '1rem', color: colors.primary }}>{notice}</div> : null}

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Open / escalated" value={open.length.toString()} accent={open.length ? colors.danger : colors.success} />
            <Kpi label="Critical" value={tickets.filter((t) => t.priority === 'critical' && t.status !== 'resolved').length.toString()} accent={colors.danger} />
            <Kpi label="From parents" value={tickets.filter((t) => t.origin === 'parent').length.toString()} />
          </div>

          <Card title="Tickets" right={
            <select style={{ ...select(), maxWidth: 180 }} value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">All origins</option><option value="school_admin">School admin</option><option value="parent">Parent</option>
            </select>}>
            {rows.map((t) => (
              <div key={t.id} style={{ borderTop: '1px solid #f3f4f6', padding: '0.75rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div><strong>{t.subject}</strong><div style={{ fontSize: '0.78rem', color: colors.muted }}>{t.school_name} · from {t.origin.replace('_', ' ')} · opened {timeAgo(t.opened_at)} · updated {timeAgo(t.last_update_at)}</div></div>
                  <span style={{ display: 'flex', gap: '0.4rem' }}><Badge status={t.priority} /><Badge status={t.status} label={t.status.replace('_', ' ')} /></span>
                </div>
                {t.status !== 'resolved' ? (
                  <div style={{ marginTop: '0.6rem', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.6rem', alignItems: 'end' }}>
                    <div><span style={label()}>Set status</span>
                      <select style={select()} value={f(t.id).status} onChange={(e) => setForm({ ...form, [t.id]: { ...f(t.id), status: e.target.value as TicketStatus } })}>
                        <option value="in_review">In review</option><option value="escalated">Escalated</option><option value="resolved">Resolved</option>
                      </select>
                    </div>
                    <div><span style={label()}>Note (required, audited)</span><input style={input()} value={f(t.id).note} onChange={(e) => setForm({ ...form, [t.id]: { ...f(t.id), note: e.target.value } })} /></div>
                    <button onClick={() => apply(t)} disabled={busy === t.id} style={btnPrimary()}>Update</button>
                  </div>
                ) : null}
              </div>
            ))}
            <AuditNote>Every ticket status change is recorded to the immutable audit trail.</AuditNote>
          </Card>
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
