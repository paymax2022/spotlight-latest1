'use client';

import { useEffect, useState } from 'react';
import { listCreatorFraud, decideCreatorFraud, formatNaira } from '@/services/creatorsAdminService';
import type { CreatorFraudSignal, CreatorFraudAction } from '@/types/creatorsAdmin';
import { PageHeader, CreatorsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, timeAgo } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function CreatorFraudPage() {
  const [rows, setRows] = useState<CreatorFraudSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCreatorFraud({ status: status || undefined, kind: kind || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind]);

  async function act(item: CreatorFraudSignal, action: CreatorFraudAction) {
    const note = window.prompt(`${action} fraud signal ${item.id} (${item.kind.replace('_', ' ')})? This is an audited action. Enter a note:`);
    if (note === null) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await decideCreatorFraud(item.id, action, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Creator abuse & self-tip fraud" subtitle="Signals for self-tipping, tip-washing, subscription/chargeback rings and content recycling. Investigate, clear or block." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <CreatorsTabs active="fraud" />
      <DisclosureNote>Self-tip and wash patterns inflate earnings and risk e-money/AML exposure. Blocking freezes the creator&apos;s payout-eligible earnings pending review. Every action posts an immutable audit event (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Subject, creator or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="cleared">Cleared</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="self_tip">Self-tip</option>
            <option value="tip_wash">Tip wash</option>
            <option value="sub_churn_abuse">Sub churn abuse</option>
            <option value="chargeback_ring">Chargeback ring</option>
            <option value="content_recycle">Content recycle</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No fraud signals in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Signal</th><th style={th()}>Creator</th><th style={th()}>Kind</th><th style={th()}>Subject</th>
              <th style={th()}>Amount</th><th style={th()}>Severity</th><th style={th()}>When</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code><div style={{ fontSize: '0.78rem', color: colors.text, marginTop: 2, maxWidth: 320 }}>{r.detail}</div></td>
                  <td style={td()}>{r.creator_handle_masked}</td>
                  <td style={td()}><Badge status={r.kind} /></td>
                  <td style={td()}>{r.subject_masked}</td>
                  <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                  <td style={td()}><Badge status={r.severity} /></td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {(r.status === 'open' || r.status === 'investigating') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {r.status === 'open' && <button style={btn()} disabled={busy === r.id} onClick={() => act(r, 'investigate')}>Investigate</button>}
                        <button style={btnPrimary()} disabled={busy === r.id} onClick={() => act(r, 'clear')}>Clear</button>
                        <button style={btnDanger()} disabled={busy === r.id} onClick={() => act(r, 'block')}>Block</button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
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
