'use client';

import { useEffect, useState } from 'react';
import { listNotificationTemplates, createNotificationTemplate } from '@/services/academyAdminService';
import type { NotificationTemplate, NotificationChannel } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, th, td, input, label, select, timeAgo } from '../_ui';

const CHANNELS: NotificationChannel[] = ['push', 'sms', 'in_app', 'email'];
const SEGMENTS = ['all_learners', 'all_parents', 'utme_2026', 'wassce_2026', 'inactive_7d', 'inactive_30d', 'paying_learners'];

export default function NotificationsPage() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<{ name: string; channel: NotificationChannel; subject: string; body: string; segment: string; schedule: NotificationTemplate['schedule'] }>({
    name: '', channel: 'push', subject: '', body: '', segment: 'all_learners', schedule: 'manual',
  });

  async function load() {
    setLoading(true); setError(null);
    try { setTemplates(await listNotificationTemplates()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.name || !form.subject || !form.body) { setNotice('Name, subject and body are required.'); return; }
    setBusy(true); setNotice(null);
    try {
      const t = await createNotificationTemplate(form);
      setNotice(`Created "${t.name}" (${t.channel}, ${t.status}).`);
      setForm({ ...form, name: '', subject: '', body: '' });
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Notifications & messaging" subtitle="Template management across push, SMS, in-app and email; segmentation, scheduled & triggered campaigns. Placeholders like {{first_name}} resolve per recipient." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="notifications" />
      <DisclosureNote>Requires <code>academy.notifications</code>. Quiet hours and deliverability throttles are enforced server-side; SMS sends respect DND. Templates start as draft until activated.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={templates.length === 0}>
        <Card title="Templates">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Name</th><th style={th()}>Channel</th><th style={th()}>Subject / Title</th>
              <th style={th()}>Segment</th><th style={th()}>Schedule</th><th style={th()}>Status</th><th style={th()}>Updated</th>
            </tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={td()}><strong>{t.name}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>{t.body}</div></td>
                  <td style={td()}><Badge status="open" label={t.channel.replace(/_/g, '-')} /></td>
                  <td style={td()}>{t.subject}</td>
                  <td style={td()}><code style={{ fontSize: '0.75rem' }}>{t.segment}</code></td>
                  <td style={td()}>{t.schedule}</td>
                  <td style={td()}><Badge status={t.status} /></td>
                  <td style={td()}>{timeAgo(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Create template">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Name</label><input style={input()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Streak Reminder" /></div>
            <div><label style={label()}>Channel</label>
              <select style={select()} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as NotificationChannel })}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c.replace(/_/g, '-')}</option>)}
              </select>
            </div>
            <div><label style={label()}>Segment</label>
              <select style={select()} value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label style={label()}>Schedule</label>
              <select style={select()} value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value as NotificationTemplate['schedule'] })}>
                <option value="manual">manual</option><option value="triggered">triggered</option><option value="scheduled">scheduled</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: '0.6rem' }}><label style={label()}>Subject / Title</label><input style={input()} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Notification title or SMS sender" /></div>
          <div style={{ marginTop: '0.6rem' }}><label style={label()}>Body</label><textarea style={{ ...input(), minHeight: 70, fontFamily: 'inherit' }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Hi {{first_name}}, …" /></div>
          <div style={{ marginTop: '0.6rem' }}><button onClick={create} disabled={busy} style={btnPrimary()}>{busy ? 'Saving…' : 'Create template'}</button></div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Template creation, edits and activation are recorded to the immutable audit log.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
