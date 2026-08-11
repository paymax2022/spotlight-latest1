'use client';

import { useEffect, useState } from 'react';
import { listNotificationTemplates, createNotificationTemplate } from '@/services/academyAdminService';
import type { NotificationTemplate, NotificationChannel } from '@/types/academyAdmin';
import { AcademyTabs, StateBlock, AuditNote, DisclosureNote, label, select, timeAgo } from '../_ui';
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
    <Page>
      <PageHeader title="Notifications & messaging" subtitle="Template management across push, SMS, in-app and email; segmentation, scheduled & triggered campaigns. Placeholders like {{first_name}} resolve per recipient." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="notifications" />
      <DisclosureNote>Requires <code>academy.notifications</code>. Quiet hours and deliverability throttles are enforced server-side; SMS sends respect DND. Templates start as draft until activated.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={templates.length === 0}>
        <Card title="Templates">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Name</th><th style={thCell}>Channel</th><th style={thCell}>Subject / Title</th>
              <th style={thCell}>Segment</th><th style={thCell}>Schedule</th><th style={thCell}>Status</th><th style={thCell}>Updated</th>
            </tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={tdCell}><strong>{t.name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>{t.body}</div></td>
                  <td style={tdCell}><StatusBadge status="open" label={t.channel.replace(/_/g, '-')} /></td>
                  <td style={tdCell}>{t.subject}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.75rem' }}>{t.segment}</code></td>
                  <td style={tdCell}>{t.schedule}</td>
                  <td style={tdCell}><StatusBadge status={t.status} /></td>
                  <td style={tdCell}>{timeAgo(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Create template">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Name</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Streak Reminder" /></div>
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
          <div style={{ marginTop: '0.6rem' }}><label style={label()}>Subject / Title</label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Notification title or SMS sender" /></div>
          <div style={{ marginTop: '0.6rem' }}><label style={label()}>Body</label><textarea style={{ minHeight: 70, fontFamily: 'inherit' }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Hi {{first_name}}, …" /></div>
          <div style={{ marginTop: '0.6rem' }}><Button onClick={create} disabled={busy} variant="primary" sm>{busy ? 'Saving…' : 'Create template'}</Button></div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Template creation, edits and activation are recorded to the immutable audit log.</AuditNote>
        </Card>
      </StateBlock>
    </Page>
  );
}
