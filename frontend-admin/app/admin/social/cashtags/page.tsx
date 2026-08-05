'use client';

import { useEffect, useState } from 'react';
import { listCashtags, reviewCashtag, formatNaira } from '@/services/socialAdminService';
import type { CashtagRecord, CashtagDecision } from '@/types/socialAdmin';
import { SocialTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../../savings/_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'active':
    case 'verified':
      return colors.success;
    case 'flagged':
    case 'abuse':
    case 'impersonation':
      return colors.warning;
    case 'suspended':
      return colors.danger;
    case 'reserved':
      return colors.secondary;
    default:
      return colors.secondary;
  }
}

export default function CashtagsPage() {
  const [rows, setRows] = useState<CashtagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCashtags({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function onReview(c: CashtagRecord, decision: CashtagDecision) {
    const note = window.prompt(`Apply "${decision}" to ${c.handle}? This is audited. Optional note:`) ?? undefined;
    if (note === undefined && decision === 'suspend') return;
    setBusy(c.id); setMsg(null);
    try {
      const res = await reviewCashtag(c.id, decision, note);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Cashtag directory" subtitle="@handle directory with abuse and impersonation review across the social-payments identity space." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SocialTabs active="cashtags" />
      <DisclosureNote>Each @handle is unique per identity and guarded against impersonation. Suspending or releasing a handle is an audited action (NL-12); reserved handles are platform-protected and cannot be claimed.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
          <Input placeholder="@handle, owner or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="active">Active</option><option value="verified">Verified</option><option value="flagged">Flagged</option><option value="suspended">Suspended</option><option value="reserved">Reserved</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No cashtags match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Handle</th><th style={thCell}>Owner</th><th style={thCell}>Status</th><th style={thCell}>Flag</th>
              <th style={thCell}>Txns (30d)</th><th style={thCell}>Volume (30d)</th><th style={thCell}>Created</th><th style={thCell}>Review</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}><strong>{c.handle}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.id}</div></td>
                  <td style={tdCell}>{c.owner_masked}</td>
                  <td style={tdCell}><Badge text={c.status.replace(/_/g, ' ')} color={statusColor(c.status)} /></td>
                  <td style={tdCell}>{c.flag_reason ? <Badge text={c.flag_reason.replace(/_/g, ' ')} color={statusColor(c.flag_reason)} /> : <span style={{ color: colors.muted }}>—</span>}</td>
                  <td style={tdCell}>{c.txn_count_30d.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{formatNaira(c.volume_30d_kobo)}</td>
                  <td style={tdCell}>{fmtDate(c.created_at)}</td>
                  <td style={tdCell}>
                    {c.status === 'reserved' ? <span style={{ color: colors.muted, fontSize: '0.78rem' }}>protected</span> : (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <Button sm variant="outline" disabled={busy === c.id} onClick={() => onReview(c, 'clear')}>Clear</Button>
                        <Button sm variant="outline" disabled={busy === c.id} onClick={() => onReview(c, 'verify')}>Verify</Button>
                        <Button sm variant="outline" disabled={busy === c.id} onClick={() => onReview(c, 'release_handle')}>Release</Button>
                        <Button sm variant="danger" disabled={busy === c.id} onClick={() => onReview(c, 'suspend')}>Suspend</Button>
                      </div>
                    )}
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
