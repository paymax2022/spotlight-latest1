'use client';

import { useEffect, useState } from 'react';
import { listCms } from '@/services/staysAdminService';
import type { CmsEntry } from '@/types/staysAdmin';
import {
  StaysTabs,
  Card,
  Badge,
  FilterBar,
  DisclosureNote,
  StateBlock,
  select,
  label,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function StaysCmsPage() {
  const [rows, setRows] = useState<CmsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      const opts: { type?: string; status?: string } = {};
      if (type) opts.type = type;
      if (status) opts.status = status;
      setRows(await listCms(Object.keys(opts).length ? opts : undefined));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [type, status]);

  return (
    <Page>
      <PageHeader
        title="CMS — cities, landmarks & SEO"
        subtitle="Content entries powering organic discovery pages across cities, landmarks and SEO landing pages."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="growth" />

      <DisclosureNote>
        SEO landing pages for cities and landmarks drive organic supply discovery — keep titles, slugs
        and meta descriptions accurate so they index and convert.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Type</label>
          <select style={select()} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            <option value="city">City</option>
            <option value="landmark">Landmark</option>
            <option value="guide">Guide</option>
            <option value="seo_page">SEO page</option>
          </select>
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No content entries found.">
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Type</th>
                <th style={thCell}>Title</th>
                <th style={thCell}>Slug</th>
                <th style={thCell}>Status</th>
                <th style={thCell}>Meta description</th>
                <th style={thCell}>Properties</th>
                <th style={thCell}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}><Badge status={c.type} label={c.type.replace(/_/g, ' ')} /></td>
                  <td style={tdCell}>{c.title}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{c.slug}</code></td>
                  <td style={tdCell}><Badge status={c.status} /></td>
                  <td style={{ ...tdCell, maxWidth: 320 }}>
                    <span style={{ color: colors.muted, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.meta_description}</span>
                  </td>
                  <td style={tdCell}>{c.properties_linked.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{timeAgo(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </Page>
  );
}
