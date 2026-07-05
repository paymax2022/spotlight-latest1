'use client';

import { useEffect, useState } from 'react';
import { listTemplates } from '@/services/staysAdminService';
import type { NotificationTemplate } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  DisclosureNote,
  StateBlock,
  FilterBar,
  btn,
  th,
  td,
  label,
  select,
  timeAgo,
} from '../_ui';

export default function StaysTemplatesPage() {
  const [rows, setRows] = useState<NotificationTemplate[]>([]);
  const [channel, setChannel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listTemplates(channel ? { channel } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [channel]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Notifications & templates"
        subtitle="Guest- and hotelier-facing message templates across email, SMS, push and WhatsApp, keyed to Paymax Stays lifecycle triggers."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="platform" />

      <DisclosureNote>
        Template content and enablement is managed through the messaging service — edits below are a
        preview only. Published changes are audited and versioned by locale.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Channel</label>
          <select style={select()} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">All</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="push">Push</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No templates found.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Name</th>
                <th style={th()}>Key</th>
                <th style={th()}>Channel</th>
                <th style={th()}>Trigger</th>
                <th style={th()}>Locale</th>
                <th style={th()}>Enabled</th>
                <th style={th()}>Updated</th>
                <th style={th()} />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td style={td()}>{t.name}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{t.key}</code></td>
                  <td style={td()}><Badge status={t.channel} label={t.channel} /></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{t.trigger}</code></td>
                  <td style={td()}>{t.locale}</td>
                  <td style={td()}><Badge status={t.enabled ? 'active' : 'disabled'} label={t.enabled ? 'Enabled' : 'Disabled'} /></td>
                  <td style={td()}>{timeAgo(t.updated_at)}</td>
                  <td style={td()}>
                    <button
                      style={btn()}
                      onClick={() => window.alert('Template editing is handled in the messaging service.')}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
