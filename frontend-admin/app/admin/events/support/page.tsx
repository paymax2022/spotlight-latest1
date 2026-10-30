'use client';

import { useEffect, useState } from 'react';
import { listSupportCases, getSupportStats, getSupportCase, replySupportCase, updateSupportCase, USE_MOCK, USE_MOCK_ENV } from '@/services/eventsGovernanceAdminService';
import type { SupportCase, SupportQueueStats, SupportStatus, SupportPriority } from '@/types/eventsGovernanceAdmin';
import { PageHeader, EventsTabs, Card, Kpi, Badge, StateBlock, FilterBar, AuditNote, btn, btnPrimary, th, td, input, label, select, timeAgo, fmtDate } from '../_ui';
import { FixtureBanner } from '../../_shared/ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES: SupportStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITIES: SupportPriority[] = ['low', 'normal', 'high', 'urgent'];
const KINDS = ['REFUND', 'TICKET', 'CHECKIN', 'PAYMENT', 'CONDUCT', 'OTHER'];

export default function SupportPage() {
  const [rows, setRows] = useState<SupportCase[]>([]);
  const [stats, setStats] = useState<SupportQueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('OPEN');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<SupportCase | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [r, s] = await Promise.all([listSupportCases({ status: status || undefined, kind: kind || undefined, q: q || undefined }), getSupportStats()]);
      setRows(r); setStats(s);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind]);

  async function view(id: string) {
    setBusy(`view:${id}`); setMsg(null);
    try { setOpen(await getSupportCase(id)); setReply(''); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function sendReply() {
    if (!open || !reply.trim()) return;
    setBusy('reply'); setMsg(null);
    try { await replySupportCase(open.id, reply.trim()); setReply(''); setOpen(await getSupportCase(open.id)); setMsg('Reply sent to the customer.'); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function triage(patch: { status?: SupportStatus; priority?: SupportPriority }) {
    if (!open) return;
    const terminal = patch.status === 'RESOLVED' || patch.status === 'CLOSED' || (open.status === 'CLOSED' && patch.status);
    let note = '';
    if (terminal) {
      const n = window.prompt(`Move case "${open.subject}" to ${patch.status?.toLowerCase().replace('_', ' ')}? The customer is notified. Note for the thread (required):`);
      if (n === null) return;
      if (!n.trim()) { setMsg('A note is required for this change.'); return; }
      note = n.trim();
    }
    setBusy('triage'); setMsg(null);
    try {
      // assigned_to is written as sent (empty = unassign), so resend the current owner.
      const out = await updateSupportCase(open.id, { ...patch, assigned_to: open.assigned_to ?? '', note: note || undefined });
      setMsg(`Case is now ${out.status.toLowerCase()} · ${out.priority}.`);
      setOpen(await getSupportCase(open.id));
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Support desk" subtitle="Customer events cases: refunds, tickets, check-in, payments and conduct." action={<button onClick={load} style={btn()} disabled={loading}>Refresh</button>} />
      <EventsTabs active="support" />
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Open" value={String(stats.open)} accent={colors.warning} sub={stats.oldest_open_at ? `oldest ${timeAgo(stats.oldest_open_at)}` : undefined} />
          <Kpi label="In progress" value={String(stats.in_progress)} accent={colors.info} />
          <Kpi label="Resolved today" value={String(stats.resolved_today)} />
          <Kpi label="Urgent / high" value={`${stats.by_priority?.urgent ?? 0} / ${stats.by_priority?.high ?? 0}`} accent={colors.danger} />
        </div>
      )}

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Subject or body…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>{KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={load} disabled={loading}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No cases match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Case</th><th style={th()}>Kind</th><th style={th()}>Event</th><th style={th()}>Priority</th>
              <th style={th()}>Status</th><th style={th()}>Replies</th><th style={th()}>Updated</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} style={open?.id === c.id ? { background: colors.headBg } : undefined}>
                  <td style={td()}>{c.subject}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.id} · opened {timeAgo(c.created_at)}</div></td>
                  <td style={td()}>{c.kind.toLowerCase()}</td>
                  <td style={td()}>{c.event_title || '—'}</td>
                  <td style={td()}><Badge status={c.priority === 'urgent' ? 'critical' : c.priority} label={c.priority} /></td>
                  <td style={td()}><Badge status={c.status.toLowerCase() === 'in_progress' ? 'processing' : c.status.toLowerCase()} label={c.status.toLowerCase().replace('_', ' ')} /></td>
                  <td style={td()}>{c.reply_count}</td>
                  <td style={td()}>{timeAgo(c.updated_at)}</td>
                  <td style={td()}><button style={btn()} disabled={busy !== null} onClick={() => view(c.id)}>{busy === `view:${c.id}` ? '…' : 'Open'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {open && (
        <Card title={`Case — ${open.subject}`} right={<button style={btn()} onClick={() => setOpen(null)}>Close</button>}>
          <div style={{ fontSize: '0.78rem', color: colors.muted, marginBottom: '0.75rem' }}>
            {open.kind.toLowerCase()} · opened by {open.opened_by} · {fmtDate(open.created_at)}
            {open.order_id && ` · order ${open.order_id}`}{open.ticket_id && ` · ticket ${open.ticket_id}`}{open.assigned_to && ` · assigned ${open.assigned_to}`}
          </div>
          <FilterBar>
            <div>
              <label style={label()}>Status</label>
              <select style={select()} value={open.status} disabled={busy !== null} onChange={(e) => triage({ status: e.target.value as SupportStatus })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Priority</label>
              <select style={select()} value={open.priority} disabled={busy !== null} onChange={(e) => triage({ priority: e.target.value as SupportPriority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </FilterBar>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {(open.messages ?? []).map((m) => (
              <div key={m.id} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.375rem', padding: '0.5rem 0.65rem', background: m.author_id === open.opened_by ? colors.card : colors.headBg }}>
                <div style={{ fontSize: '0.72rem', color: colors.muted }}>{m.author_name || (m.author_id === open.opened_by ? 'Customer' : m.author_id)} · {timeAgo(m.created_at)}</div>
                <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{m.body}</div>
              </div>
            ))}
            {(open.messages ?? []).length === 0 && <p style={{ color: colors.muted, fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{open.body}</p>}
          </div>
          <label style={label()}>Reply to customer</label>
          <textarea style={{ ...input(), minHeight: 80 }} value={reply} onChange={(e) => setReply(e.target.value)} disabled={open.status === 'CLOSED'} placeholder={open.status === 'CLOSED' ? 'Case is closed — reopen it to reply.' : ''} />
          <div style={{ marginTop: '0.5rem' }}>
            <button style={btnPrimary()} disabled={busy !== null || !reply.trim() || open.status === 'CLOSED'} onClick={sendReply}>{busy === 'reply' ? 'Sending…' : 'Send reply'}</button>
          </div>
        </Card>
      )}
    </div>
  );
}
