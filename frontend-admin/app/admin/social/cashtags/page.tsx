'use client';

import { useEffect, useState } from 'react';
import { listCashtags, reviewCashtag, formatNaira } from '@/services/socialAdminService';
import type { CashtagRecord, CashtagDecision } from '@/types/socialAdmin';
import { PageHeader, SocialTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnDanger, th, td, input, label, select, fmtDate } from '../../savings/_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Cashtag directory" subtitle="@handle directory with abuse and impersonation review across the social-payments identity space." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SocialTabs active="cashtags" />
      <DisclosureNote>Each @handle is unique per identity and guarded against impersonation. Suspending or releasing a handle is an audited action (NL-12); reserved handles are platform-protected and cannot be claimed.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="@handle, owner or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="active">Active</option><option value="verified">Verified</option><option value="flagged">Flagged</option><option value="suspended">Suspended</option><option value="reserved">Reserved</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No cashtags match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Handle</th><th style={th()}>Owner</th><th style={th()}>Status</th><th style={th()}>Flag</th>
              <th style={th()}>Txns (30d)</th><th style={th()}>Volume (30d)</th><th style={th()}>Created</th><th style={th()}>Review</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><strong>{c.handle}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.id}</div></td>
                  <td style={td()}>{c.owner_masked}</td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={td()}>{c.flag_reason ? <Badge status={c.flag_reason} /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{c.txn_count_30d.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatNaira(c.volume_30d_kobo)}</td>
                  <td style={td()}>{fmtDate(c.created_at)}</td>
                  <td style={td()}>
                    {c.status === 'reserved' ? <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>protected</span> : (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btn()} disabled={busy === c.id} onClick={() => onReview(c, 'clear')}>Clear</button>
                        <button style={btn()} disabled={busy === c.id} onClick={() => onReview(c, 'verify')}>Verify</button>
                        <button style={btn()} disabled={busy === c.id} onClick={() => onReview(c, 'release_handle')}>Release</button>
                        <button style={btnDanger()} disabled={busy === c.id} onClick={() => onReview(c, 'suspend')}>Suspend</button>
                      </div>
                    )}
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
