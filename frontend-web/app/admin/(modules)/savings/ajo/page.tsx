'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listAjoCircles, formatNaira } from '@/services/savingsAdminService';
import type { AjoCircleSummary } from '@/types/savingsAdmin';
import { SavingsTabs, DisclosureNote, StateBlock, FilterBar, fmtDate, pct } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SUCCESS_STATUSES = new Set(['active', 'open', 'matured', 'completed', 'settled', 'reconciled', 'resolved', 'paid', 'healthy', 'approved', 'on_track', 'recovered', 'cleared', 'balanced', 'verified', 'contribution']);
const DANGER_STATUSES = new Set(['rejected', 'failed', 'defaulted', 'blocked', 'high', 'critical', 'breached', 'suspended', 'impersonation', 'abuse']);
const WARNING_STATUSES = new Set(['pending', 'forming', 'scheduled', 'queued', 'flagged', 'degraded', 'at_risk', 'locked', 'grace', 'review', 'under_review', 'late', 'medium', 'debit', 'hold']);
const INFO_STATUSES = new Set(['investigating', 'processing', 'collecting', 'flex', 'normal', 'invited', 'payment', 'split', 'payout']);
const PRIMARY_STATUSES = new Set(['refunded', 'reversed', 'reversal', 'make_good', 'pool', 'request']);

function badgeColor(status: string): string {
  const s = status.toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return colors.success;
  if (DANGER_STATUSES.has(s)) return colors.danger;
  if (WARNING_STATUSES.has(s)) return colors.warning;
  if (INFO_STATUSES.has(s)) return colors.info;
  if (PRIMARY_STATUSES.has(s)) return colors.primary;
  return colors.secondary;
}

function badgeText(status: string, label?: string): string {
  const t = (label ?? status.replace(/_/g, ' ')).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function AjoPage() {
  const [rows, setRows] = useState<AjoCircleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [health, setHealth] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAjoCircles({ status: status || undefined, health: health || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, health]);

  return (
    <Page>
      <PageHeader title="Ajo circle monitoring" subtitle="Collections per cycle, payout queue and circle health across all rotating-savings (Ajo/Esusu) circles." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SavingsTabs active="ajo" />
      <DisclosureNote>NL-7 — Ajo is <strong>peer rotation</strong>: members fund each other. Paymax is ledger + escrow only and never advances credit or guarantees a cycle. NL-2 — no yield on held contributions.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label>Search</label>
          <Input placeholder="Circle name or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="forming">Forming</option><option value="active">Active</option><option value="completed">Completed</option><option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label>Health</label>
          <select value={health} onChange={(e) => setHealth(e.target.value)}>
            <option value="">All</option><option value="healthy">Healthy</option><option value="at_risk">At risk</option><option value="defaulted">Defaulted</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ overflowX: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No circles match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Circle</th><th style={thCell}>Status</th><th style={thCell}>Health</th><th style={thCell}>Members</th>
              <th style={thCell}>Cycle</th><th style={thCell}>Collected this cycle</th><th style={thCell}>Defaults</th><th style={thCell}>Next payout</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}>{c.name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.id} · {formatNaira(c.contribution_kobo)}/{c.frequency}</div></td>
                  <td style={tdCell}><Badge text={badgeText(c.status)} color={badgeColor(c.status)} /></td>
                  <td style={tdCell}><Badge text={badgeText(c.health)} color={badgeColor(c.health)} /></td>
                  <td style={tdCell}>{c.members_count}</td>
                  <td style={tdCell}>{c.cycle_index}/{c.total_cycles}</td>
                  <td style={tdCell}>{formatNaira(c.collected_this_cycle_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>/ {formatNaira(c.expected_this_cycle_kobo)} ({c.expected_this_cycle_kobo ? pct(c.collected_this_cycle_kobo / c.expected_this_cycle_kobo) : '0%'})</span></td>
                  <td style={tdCell}>{c.defaults_count > 0 ? <Badge text={`${c.defaults_count}`} color={badgeColor('defaulted')} /> : <span style={{ color: colors.success }}>0</span>}</td>
                  <td style={tdCell}>{c.next_payout_member_masked ? <>{c.next_payout_member_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{formatNaira(c.next_payout_kobo)} · {fmtDate(c.next_payout_date)}</div></> : '—'}</td>
                  <td style={tdCell}><Link href={`/admin/savings/ajo/${c.id}`} className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none', display: 'inline-block' }}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
