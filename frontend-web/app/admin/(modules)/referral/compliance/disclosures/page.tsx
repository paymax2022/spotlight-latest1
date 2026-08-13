'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listDisclosures } from '@/services/referralAdminOpsService';
import type { Disclosure } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'draft', 'active', 'archived'];

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

export default function DisclosuresPage() {
  const [rows, setRows] = useState<Disclosure[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDisclosures(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <Page>
      <PageHeader
        title="Compliance — Disclosures & T&Cs"
        subtitle="Versioned terms and earnings disclosures with acceptance tracking (A-CMPL-02)."
        actions={<Link href="/admin/referral/compliance" className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>← Policy</Link>}
      />

      <Card title="Disclosure versions">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No disclosures.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Title</th><th style={thCell}>Version</th><th style={thCell}>Status</th>
                <th style={thCell}>Effective</th><th style={thCell}>Required</th><th style={thCell}>Acceptance</th><th style={thCell}>Updated</th>
              </tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td style={tdCell}>{d.title}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{d.version}</code></td>
                    <td style={tdCell}><StatusBadge status={d.status === 'active' ? 'active' : d.status === 'draft' ? 'draft' : 'closed'} label={d.status} /></td>
                    <td style={tdCell}>{d.effective_date}</td>
                    <td style={tdCell}>{d.required ? 'Yes' : 'No'}</td>
                    <td style={tdCell}>{`${(d.acceptance_rate * 100).toFixed(0)}%`}</td>
                    <td style={tdCell}>{timeAgo(d.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
