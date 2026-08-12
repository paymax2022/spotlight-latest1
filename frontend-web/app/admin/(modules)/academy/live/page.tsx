'use client';

import { useEffect, useState } from 'react';
import { listLiveSessions, scheduleLiveSession, listLiveReplays } from '@/services/academyAdminService';
import type { LiveSession, LiveReplay } from '@/types/academyAdmin';
import { AcademyTabs, Kpi, StateBlock, AuditNote, DisclosureNote, label, select, fmtDate, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

export default function LivePage() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [replays, setReplays] = useState<LiveReplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ title: '', subject: '', host: '', starts_at: '', duration: '60', provider: 'hls' });

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, r] = await Promise.all([listLiveSessions(), listLiveReplays()]);
      setSessions(s); setReplays(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function schedule() {
    const dur = Number(form.duration);
    if (!form.title || !form.subject || !form.host || !form.starts_at || !dur) { setNotice('Title, subject, host, start time and duration are required.'); return; }
    setBusy(true); setNotice(null);
    try {
      const s = await scheduleLiveSession({ title: form.title, subject: form.subject, host: form.host, starts_at: new Date(form.starts_at).toISOString(), duration_min: dur, stream_provider: form.provider as LiveSession['stream_provider'] });
      setNotice(`Scheduled "${s.title}".`);
      setForm({ title: '', subject: '', host: '', starts_at: '', duration: '60', provider: 'hls' });
      await load();
    } catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }

  const liveNow = sessions.filter((s) => s.status === 'live').length;
  const scheduled = sessions.filter((s) => s.status === 'scheduled').length;
  const replaysReady = replays.filter((r) => r.status === 'ready').length;

  return (
    <Page>
      <PageHeader title="Live & events" subtitle="Schedule live classes, configure streaming, monitor live sessions and manage replays." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="live" />
      <DisclosureNote>
        Requires <code>academy.live</code>. Session lifecycle: <strong>scheduled → live → ended</strong>. Ingest endpoints are masked; streaming is provider-routed (HLS / WebRTC / RTMP). Replays are processed asynchronously and published once ready.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Live now" value={liveNow.toString()} accent={liveNow > 0 ? colors.success : undefined} />
          <Kpi label="Scheduled" value={scheduled.toString()} accent={colors.primary} />
          <Kpi label="Total registered" value={sessions.reduce((s, x) => s + x.registered, 0).toLocaleString('en-NG')} />
          <Kpi label="Replays ready" value={replaysReady.toString()} sub={`${replays.length} total`} />
        </div>

        <Card title="Sessions">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Session</th><th style={thCell}>Subject</th><th style={thCell}>Host</th><th style={thCell}>Starts</th><th style={thCell}>Duration</th><th style={thCell}>Registered</th><th style={thCell}>Peak</th><th style={thCell}>Provider</th><th style={thCell}>Status</th><th style={thCell}>Replay</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td style={tdCell}><strong>{s.title}</strong></td>
                  <td style={tdCell}>{s.subject}</td>
                  <td style={tdCell}>{s.host}</td>
                  <td style={tdCell}>{timeAgo(s.starts_at)}<div style={{ color: colors.muted, fontSize: '0.72rem' }}>{fmtDate(s.starts_at)}</div></td>
                  <td style={tdCell}>{s.duration_min}m</td>
                  <td style={tdCell}>{s.registered.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{s.peak_viewers === null ? '—' : s.peak_viewers.toLocaleString('en-NG')}</td>
                  <td style={tdCell}><span style={{ textTransform: 'uppercase', fontSize: '0.72rem', color: colors.muted }}>{s.stream_provider}</span></td>
                  <td style={tdCell}><StatusBadge status={s.status} /></td>
                  <td style={tdCell}><StatusBadge status={s.replay_status} label={s.replay_status === 'none' ? '—' : s.replay_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Schedule a live session">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Title</label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><label style={label()}>Subject</label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div><label style={label()}>Host</label><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
            <div><label style={label()}>Starts at</label><Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></div>
            <div><label style={label()}>Duration (min)</label><Input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></div>
            <div><label style={label()}>Stream provider</label><select style={select()} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}><option value="hls">HLS</option><option value="webrtc">WebRTC</option><option value="rtmp">RTMP</option></select></div>
            <div><Button onClick={schedule} disabled={busy} variant="primary" sm>Schedule</Button></div>
          </div>
          <div style={{ border: `1px solid ${colors.border}`, background: colors.headBg, borderRadius: '0.375rem', padding: '0.5rem 0.7rem', fontSize: '0.75rem', color: colors.muted, marginTop: '0.6rem' }}>
            Streaming config: a masked ingest URL is provisioned per session on schedule. HLS for large audiences (low cost), WebRTC for low-latency interactive solves, RTMP for studio encoders. Configure CDN/keys in the streaming provider console.
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Scheduling, going live, ending sessions and publishing replays are recorded to the immutable audit log.</AuditNote>
        </Card>

        <Card title="Replays">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Replay</th><th style={thCell}>Status</th><th style={thCell}>Duration</th><th style={thCell}>Size</th><th style={thCell}>Views</th><th style={thCell}>Published</th><th style={thCell}>Created</th></tr></thead>
            <tbody>
              {replays.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><strong>{r.title}</strong></td>
                  <td style={tdCell}><StatusBadge status={r.status} /></td>
                  <td style={tdCell}>{r.duration_min}m</td>
                  <td style={tdCell}>{r.size_mb > 0 ? `${r.size_mb} MB` : '—'}</td>
                  <td style={tdCell}>{r.views.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{r.published ? <StatusBadge status="published" /> : <StatusBadge status="draft" label="unpublished" />}</td>
                  <td style={tdCell}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </Page>
  );
}
