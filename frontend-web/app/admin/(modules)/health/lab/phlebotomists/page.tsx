'use client';

import { useEffect, useState } from 'react';
import { listPhlebotomists } from '@/services/healthLabAdminService';
import type { Phlebotomist } from '@/types/healthLabAdmin';
import { LabTabs, DisclosureNote, StateBlock, FilterBar, fmtDate } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'active', 'pending', 'suspended', 'expired'];

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (v === 'tier0') return colors.danger;
  if (v === 'tier1') return colors.warning;
  if (v === 'tier2') return colors.info;
  if (v === 'tier3') return colors.success;
  if (/(reject|fail|block|suspend|high)/.test(v)) return colors.danger;
  if (/(pending|warn|flag|medium)/.test(v)) return colors.warning;
  if (/(active|approve|verified|complete|ok)/.test(v)) return colors.success;
  return colors.secondary;
}

export default function PhlebotomistsPage() {
  const [rows, setRows] = useState<Phlebotomist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPhlebotomists({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <Page>
      <PageHeader title="Phlebotomist management" subtitle="Field collectors dispatched on the last-mile rail. Credential, KYC and custody-quality (HL-6) signals at a glance; licences auto-suspend on expiry (HL-2)." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="phlebotomists" />

      <DisclosureNote>
        Phlebotomists must hold a valid licence (HL-2) and clear KYC before dispatch. Custody-break counts are a
        quality signal under HL-6 — repeated breaks trigger review. Personal data is masked under NDPA (HL-8).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Name, licence no, state, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No phlebotomists match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Phlebotomist</th><th style={thCell}>Licence</th><th style={thCell}>Expiry</th>
                <th style={thCell}>State</th><th style={thCell}>KYC</th><th style={thCell}>Collections (30d)</th>
                <th style={thCell}>Custody breaks</th><th style={thCell}>Rating</th><th style={thCell}>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><strong>{r.name_masked}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                    <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.licence_no}</code></td>
                    <td style={tdCell}>{fmtDate(r.licence_expires_at)}{r.licence_expires_at && new Date(r.licence_expires_at) < new Date() ? <div style={{ fontSize: '0.7rem', color: colors.danger }}>expired</div> : null}</td>
                    <td style={tdCell}>{r.state}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.lga}</div></td>
                    <td style={tdCell}><Badge text={r.kyc_tier} color={statusColor(r.kyc_tier)} />{r.kyc_verified ? null : <div style={{ fontSize: '0.7rem', color: colors.danger }}>unverified</div>}</td>
                    <td style={tdCell}>{r.collections_30d.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{r.custody_breaks_30d > 0 ? <Badge text={String(r.custody_breaks_30d)} color={r.custody_breaks_30d >= 3 ? colors.danger : colors.warning} /> : '0'}</td>
                    <td style={tdCell}>{r.rating > 0 ? `${r.rating.toFixed(1)} ★` : '—'}</td>
                    <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>
    </Page>
  );
}
