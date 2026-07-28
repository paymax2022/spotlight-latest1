'use client';

import { useEffect, useState } from 'react';
import { listCms } from '@/services/staysAdminService';
import type { CmsEntry } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  FilterBar,
  DisclosureNote,
  StateBlock,
  btn,
  th,
  td,
  select,
  label,
  timeAgo,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="CMS — cities, landmarks & SEO"
        subtitle="Content entries powering organic discovery pages across cities, landmarks and SEO landing pages."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
                <th style={th()}>Type</th>
                <th style={th()}>Title</th>
                <th style={th()}>Slug</th>
                <th style={th()}>Status</th>
                <th style={th()}>Meta description</th>
                <th style={th()}>Properties</th>
                <th style={th()}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><Badge status={c.type} label={c.type.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{c.title}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.slug}</code></td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={{ ...td(), maxWidth: 320 }}>
                    <span style={{ color: '#6b7280', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.meta_description}</span>
                  </td>
                  <td style={td()}>{c.properties_linked.toLocaleString('en-NG')}</td>
                  <td style={td()}>{timeAgo(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
