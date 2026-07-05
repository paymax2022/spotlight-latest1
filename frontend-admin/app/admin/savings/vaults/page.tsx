'use client';

import { useEffect, useState } from 'react';
import { listVaults, forceUnlock, formatNaira } from '@/services/savingsAdminService';
import type { VaultRecord } from '@/types/savingsAdmin';
import { PageHeader, SavingsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnDanger, th, td, input, label, select, fmtDate } from '../_ui';

export default function VaultsPage() {
  const [rows, setRows] = useState<VaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listVaults({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function onForceUnlock(v: VaultRecord) {
    const reason = window.prompt(`Force-unlock "${v.name}" (${v.id})? This is an audited override. Enter a reason:`);
    if (!reason) return;
    setBusy(v.id); setMsg(null);
    try {
      const res = await forceUnlock(v.id, reason);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Vault oversight" subtitle="Goal-vault book oversight with audited force-unlock for hardship / dispute cases." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SavingsTabs active="vaults" />
      <DisclosureNote>NL-2 — vaults accrue <strong>zero yield</strong>; force-unlock returns principal only. Every force-unlock posts a balanced reversing ledger entry and an immutable audit event (NL-8 / NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Name, owner or vault id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="locked">Locked</option>
            <option value="flex">Flex</option>
            <option value="matured">Matured</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No vaults match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Vault</th><th style={th()}>Owner</th><th style={th()}>Type</th><th style={th()}>Status</th>
              <th style={th()}>Balance</th><th style={th()}>Target</th><th style={th()}>Yield</th><th style={th()}>Auto-save</th>
              <th style={th()}>Locked until</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={td()}>{v.name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{v.id}</div></td>
                  <td style={td()}>{v.owner_masked}</td>
                  <td style={td()}><Badge status={v.lock_type === 'LOCKED' ? 'locked' : 'flex'} label={v.lock_type} /></td>
                  <td style={td()}><Badge status={v.status} />{v.early_break_requested && <div style={{ marginTop: 4 }}><Badge status="flagged" label="break requested" /></div>}</td>
                  <td style={td()}>{formatNaira(v.balance_kobo)}</td>
                  <td style={td()}>{v.target_kobo ? formatNaira(v.target_kobo) : '—'}</td>
                  <td style={td()}><span style={{ color: '#15803d', fontWeight: 600 }}>{formatNaira(v.yield_kobo)}</span></td>
                  <td style={td()}>{v.auto_save_enabled ? `${formatNaira(v.auto_save_amount_kobo)} / ${v.auto_save_frequency}` : 'off'}</td>
                  <td style={td()}>{fmtDate(v.locked_until)}</td>
                  <td style={td()}>
                    {v.status === 'locked'
                      ? <button style={btnDanger()} disabled={busy === v.id} onClick={() => onForceUnlock(v)}>{busy === v.id ? '…' : 'Force-unlock'}</button>
                      : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
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
