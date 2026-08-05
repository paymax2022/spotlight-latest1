'use client';

import { useEffect, useState } from 'react';
import { listTemplates } from '@/services/staysAdminService';
import type { NotificationTemplate } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  DisclosureNote,
  StateBlock,
  FilterBar,
  label,
  select,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Card, Button, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Notifications & templates"
        subtitle="Guest- and hotelier-facing message templates across email, SMS, push and WhatsApp, keyed to Paymax Stays lifecycle triggers."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
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
                <th style={thCell}>Name</th>
                <th style={thCell}>Key</th>
                <th style={thCell}>Channel</th>
                <th style={thCell}>Trigger</th>
                <th style={thCell}>Locale</th>
                <th style={thCell}>Enabled</th>
                <th style={thCell}>Updated</th>
                <th style={thCell} />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td style={tdCell}>{t.name}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{t.key}</code></td>
                  <td style={tdCell}><Badge status={t.channel} label={t.channel} /></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{t.trigger}</code></td>
                  <td style={tdCell}>{t.locale}</td>
                  <td style={tdCell}><Badge status={t.enabled ? 'active' : 'disabled'} label={t.enabled ? 'Enabled' : 'Disabled'} /></td>
                  <td style={tdCell}>{timeAgo(t.updated_at)}</td>
                  <td style={tdCell}>
                    <Button
                      variant="outline"
                      sm
                      onClick={() => window.alert('Template editing is handled in the messaging service.')}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
