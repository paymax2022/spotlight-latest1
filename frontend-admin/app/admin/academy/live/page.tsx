'use client';

import { useEffect, useState } from 'react';
import { listLiveSessions, scheduleLiveSession, listLiveReplays } from '@/services/academyAdminService';
import type { LiveSession, LiveReplay } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, th, td, input, label, select, fmtDate, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Live & events" subtitle="Schedule live classes, configure streaming, monitor live sessions and manage replays." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="live" />
      <DisclosureNote>
        Requires <code>academy.live</code>. Session lifecycle: <strong>scheduled → live → ended</strong>. Ingest endpoints are masked; streaming is provider-routed (HLS / WebRTC / RTMP). Replays are processed asynchronously and published once ready.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Live now" value={liveNow.toString()} accent={liveNow > 0 ? '#15803d' : undefined} />
          <Kpi label="Scheduled" value={scheduled.toString()} accent="#340075" />
          <Kpi label="Total registered" value={sessions.reduce((s, x) => s + x.registered, 0).toLocaleString('en-NG')} />
          <Kpi label="Replays ready" value={replaysReady.toString()} sub={`${replays.length} total`} />
        </div>

        <Card title="Sessions">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Session</th><th style={th()}>Subject</th><th style={th()}>Host</th><th style={th()}>Starts</th><th style={th()}>Duration</th><th style={th()}>Registered</th><th style={th()}>Peak</th><th style={th()}>Provider</th><th style={th()}>Status</th><th style={th()}>Replay</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td style={td()}><strong>{s.title}</strong></td>
                  <td style={td()}>{s.subject}</td>
                  <td style={td()}>{s.host}</td>
                  <td style={td()}>{timeAgo(s.starts_at)}<div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{fmtDate(s.starts_at)}</div></td>
                  <td style={td()}>{s.duration_min}m</td>
                  <td style={td()}>{s.registered.toLocaleString('en-NG')}</td>
                  <td style={td()}>{s.peak_viewers === null ? '—' : s.peak_viewers.toLocaleString('en-NG')}</td>
                  <td style={td()}><span style={{ textTransform: 'uppercase', fontSize: '0.72rem', color: '#6b7280' }}>{s.stream_provider}</span></td>
                  <td style={td()}><Badge status={s.status} /></td>
                  <td style={td()}><Badge status={s.replay_status} label={s.replay_status === 'none' ? '—' : s.replay_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Schedule a live session">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Title</label><input style={input()} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><label style={label()}>Subject</label><input style={input()} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div><label style={label()}>Host</label><input style={input()} value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
            <div><label style={label()}>Starts at</label><input type="datetime-local" style={input()} value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></div>
            <div><label style={label()}>Duration (min)</label><input type="number" style={input()} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></div>
            <div><label style={label()}>Stream provider</label><select style={select()} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}><option value="hls">HLS</option><option value="webrtc">WebRTC</option><option value="rtmp">RTMP</option></select></div>
            <div><button onClick={schedule} disabled={busy} style={btnPrimary()}>Schedule</button></div>
          </div>
          <div style={{ border: '1px solid #e5e7eb', background: '#f9fafb', borderRadius: '0.375rem', padding: '0.5rem 0.7rem', fontSize: '0.75rem', color: '#6b7280', marginTop: '0.6rem' }}>
            Streaming config: a masked ingest URL is provisioned per session on schedule. HLS for large audiences (low cost), WebRTC for low-latency interactive solves, RTMP for studio encoders. Configure CDN/keys in the streaming provider console.
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Scheduling, going live, ending sessions and publishing replays are recorded to the immutable audit log.</AuditNote>
        </Card>

        <Card title="Replays">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Replay</th><th style={th()}>Status</th><th style={th()}>Duration</th><th style={th()}>Size</th><th style={th()}>Views</th><th style={th()}>Published</th><th style={th()}>Created</th></tr></thead>
            <tbody>
              {replays.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.title}</strong></td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{r.duration_min}m</td>
                  <td style={td()}>{r.size_mb > 0 ? `${r.size_mb} MB` : '—'}</td>
                  <td style={td()}>{r.views.toLocaleString('en-NG')}</td>
                  <td style={td()}>{r.published ? <Badge status="published" /> : <Badge status="draft" label="unpublished" />}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
