'use client';

import { useEffect, useState } from 'react';
import { listModerationQueue, getModerationTrail, reviewEvent, USE_MOCK, USE_MOCK_ENV } from '@/services/eventsGovernanceAdminService';
import type { ModerationQueueItem, ModerationAction, ModerationDecision } from '@/types/eventsGovernanceAdmin';
import { PageHeader, EventsTabs, Card, Badge, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate, timeAgo } from '../_ui';
import { FixtureBanner } from '../../_shared/ui';
import { colors } from '@/components/ui/vuexy';

const ACTIONS: Record<string, { action: ModerationAction; label: string; danger?: boolean; needsReason?: boolean }[]> = {
  submitted: [{ action: 'approve', label: 'Approve' }, { action: 'changes', label: 'Request changes', needsReason: true }, { action: 'reject', label: 'Reject', danger: true, needsReason: true }],
  approved: [{ action: 'suspend', label: 'Suspend', danger: true, needsReason: true }],
  live: [{ action: 'suspend', label: 'Suspend', danger: true, needsReason: true }],
  suspended: [{ action: 'reinstate', label: 'Reinstate' }],
};

export default function ModerationPage() {
  const [rows, setRows] = useState<ModerationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('submitted');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ event: ModerationQueueItem; rows: ModerationDecision[] } | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listModerationQueue({ status, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function openTrail(ev: ModerationQueueItem) {
    setBusy(`trail:${ev.id}`); setMsg(null);
    try { setTrail({ event: ev, rows: await getModerationTrail(ev.id) }); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function act(ev: ModerationQueueItem, a: (typeof ACTIONS)[string][number]) {
    const reason = window.prompt(`${a.label} "${ev.title}" (${ev.id})? The organiser is notified and the decision is recorded on the moderation trail. Reason${a.needsReason ? ' (required)' : ' (optional)'}:`);
    if (reason === null) return;
    if (a.needsReason && !reason.trim()) { setMsg(`A reason is required to ${a.label.toLowerCase()}.`); return; }
    setBusy(ev.id); setMsg(null);
    try {
      await reviewEvent(ev.id, a.action, reason.trim());
      setMsg(`${a.label}: "${ev.title}" done.`);
      if (trail?.event.id === ev.id) setTrail(null);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Moderation queue" subtitle="Events waiting on platform review, plus suspend / reinstate for published events. Every decision lands on the event's moderation trail." action={<button onClick={load} style={btn()} disabled={loading}>Refresh</button>} />
      <EventsTabs active="moderation" />
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search title</label>
          <input style={input()} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>State</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['submitted', 'draft', 'approved', 'live', 'paused', 'suspended', 'closed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={load} disabled={loading}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="Nothing in this state.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Event</th><th style={th()}>Organiser</th><th style={th()}>Starts</th><th style={th()}>Capacity</th>
              <th style={th()}>Submitted</th><th style={th()}>State</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((ev) => (
                <tr key={ev.id}>
                  <td style={td()}>{ev.title}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{ev.id} · {ev.category}{ev.refund_policy ? ` · refunds ${ev.refund_policy.toLowerCase()}` : ''}</div></td>
                  <td style={td()}>{ev.organiser_masked}</td>
                  <td style={td()}>{fmtDate(ev.starts_at)}</td>
                  <td style={td()}>{ev.capacity.toLocaleString()}</td>
                  <td style={td()}>{ev.submitted_at ? timeAgo(ev.submitted_at) : '—'}</td>
                  <td style={td()}><Badge status={ev.status} />{ev.moderation_note && <div style={{ fontSize: '0.72rem', color: colors.muted }}>{ev.moderation_note}</div>}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {(ACTIONS[ev.status] ?? []).map((a) => (
                        <button key={a.action} style={a.danger ? btnDanger() : a.action === 'approve' ? btnPrimary() : btn()} disabled={busy !== null} onClick={() => act(ev, a)}>{busy === ev.id ? '…' : a.label}</button>
                      ))}
                      <button style={btn()} disabled={busy !== null} onClick={() => openTrail(ev)}>{busy === `trail:${ev.id}` ? '…' : 'Trail'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {trail && (
        <Card title={`Moderation trail — ${trail.event.title}`} right={<button style={btn()} onClick={() => setTrail(null)}>Close</button>}>
          <StateBlock loading={false} error={null} empty={trail.rows.length === 0} emptyText="No decisions recorded yet.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>When</th><th style={th()}>Action</th><th style={th()}>Transition</th><th style={th()}>By</th><th style={th()}>Reason</th></tr></thead>
              <tbody>
                {trail.rows.map((d) => (
                  <tr key={d.id}>
                    <td style={td()}>{fmtDate(d.created_at)}</td>
                    <td style={td()}>{d.action.replace(/_/g, ' ')}</td>
                    <td style={td()}>{(d.from_state ?? '?').toLowerCase()} → {(d.to_state ?? '?').toLowerCase()}</td>
                    <td style={td()}>{d.actor_name || d.actor_id || '—'}</td>
                    <td style={td()}>{d.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </Card>
      )}
    </div>
  );
}
