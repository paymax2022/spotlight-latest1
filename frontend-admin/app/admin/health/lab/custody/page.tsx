'use client';

import { useEffect, useState } from 'react';
import { listCustody, getCustodyChain, flagCustodyBreak } from '@/services/healthLabAdminService';
import type { CustodySample, CustodyChain } from '@/types/healthLabAdmin';
import { PageHeader, LabTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label, timeAgo } from '../../_ui';

const STATUSES = ['', 'collected', 'in_custody', 'handed_over', 'accessioned', 'breached', 'recollect_required'];

export default function CustodyPage() {
  const [rows, setRows] = useState<CustodySample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [chain, setChain] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<CustodyChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCustody({ status: status || undefined, chain: chain || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, chain]);

  async function viewChain(id: string) {
    setChainLoading(true); setOpen(null);
    try { setOpen(await getCustodyChain(id)); }
    catch (e) { setMsg(String(e)); }
    finally { setChainLoading(false); }
  }

  async function flagBreak(id: string) {
    setBusy(true); setMsg(null);
    try { const r = await flagCustodyBreak(id, 'Manual custody-break flag by ops review'); setMsg(r.message); await load(); if (open?.id === id) await viewChain(id); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  const breaks = rows.filter((r) => !r.chain_intact).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Chain-of-custody oversight" subtitle="Track every sample from collection to accession on an immutable custody log. Any break forces recollection — no result is released on a broken chain (HL-6)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LabTabs active="custody" />

      <DisclosureNote>
        HL-6 — chain-of-custody integrity. Each sample carries a tamper-evident seal and cold-chain log
        (COLLECTED → IN_CUSTODY → HANDED_OVER → ACCESSIONED). A break (seal broken, temperature excursion,
        custody gap) marks the chain BROKEN → RECOLLECT_REQUIRED; the result pipeline is blocked until a fresh
        sample is collected. All custody events are written to the immutable audit log (HL-12).
      </DisclosureNote>

      {breaks > 0 && (
        <div style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem', fontWeight: 600 }}>
          {breaks} sample{breaks > 1 ? 's' : ''} with a broken chain in view — recollection required (HL-6). Results are blocked for these.
        </div>
      )}

      <FilterBar>
        <div>
          <label style={label()}>Custody status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Chain</label>
          <select style={select()} value={chain} onChange={(e) => setChain(e.target.value)}>
            <option value="">All</option>
            <option value="broken">Broken only</option>
            <option value="intact">Intact only</option>
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Patient, lab, order ref, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No samples match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Sample</th><th style={th()}>Order</th><th style={th()}>Patient</th>
              <th style={th()}>Test</th><th style={th()}>Phlebotomist</th><th style={th()}>Chain</th>
              <th style={th()}>Status</th><th style={th()}>Updated</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={!r.chain_intact ? { background: '#fef2f2' } : undefined}>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.order_ref}</code></td>
                  <td style={td()}>{r.patient_masked}</td>
                  <td style={td()}>{r.test_summary}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.lab_masked}</div></td>
                  <td style={td()}>{r.phlebotomist_masked}</td>
                  <td style={td()}><Badge status={r.chain_intact ? 'ok' : 'breached'} label={r.chain_intact ? 'intact' : 'broken'} />{r.break_reason ? <div style={{ fontSize: '0.72rem', color: '#b91c1c', marginTop: 2, maxWidth: 280 }}>{r.break_reason}</div> : null}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{timeAgo(r.updated_at)}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button style={btn()} onClick={() => viewChain(r.id)}>Chain</button>
                      {r.chain_intact && <button disabled={busy} style={btnDanger()} onClick={() => flagBreak(r.id)}>Flag break</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {chainLoading && <p style={{ color: '#6b7280' }}>Loading chain…</p>}
      {open && (
        <Card title={`Custody chain — ${open.id}`} right={<button style={btn()} onClick={() => setOpen(null)}>Close</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: '#6b7280' }}>Order:</span> {open.order_ref}</div>
            <div><span style={{ color: '#6b7280' }}>Patient:</span> {open.patient_masked}</div>
            <div><span style={{ color: '#6b7280' }}>Test:</span> {open.test_summary}</div>
            <div><span style={{ color: '#6b7280' }}>Chain:</span> <Badge status={open.chain_intact ? 'ok' : 'breached'} label={open.chain_intact ? 'intact' : 'broken'} /></div>
          </div>
          {!open.chain_intact && (
            <div style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: '0.5rem', padding: '0.5rem 0.7rem', fontSize: '0.8rem', marginBottom: '1rem', fontWeight: 600 }}>
              Broken chain — recollection mandated. No result will be released on this sample (HL-6).
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Step</th><th style={th()}>Detail</th><th style={th()}>Actor</th><th style={th()}>Location</th><th style={th()}>Temp</th><th style={th()}>Seal</th><th style={th()}>Audit</th><th style={th()}>When</th></tr></thead>
            <tbody>
              {open.events.map((e) => (
                <tr key={e.id} style={e.step === 'BREACHED' || e.step === 'RECOLLECT_REQUIRED' ? { background: '#fef2f2' } : undefined}>
                  <td style={td()}><Badge status={e.step.toLowerCase()} label={e.step.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{e.label}</td>
                  <td style={td()}>{e.actor_masked}</td>
                  <td style={td()}>{e.location}</td>
                  <td style={td()}>{e.temperature_c == null ? '—' : `${e.temperature_c}°C`}</td>
                  <td style={td()}><Badge status={e.seal_intact ? 'ok' : 'breached'} label={e.seal_intact ? 'intact' : 'broken'} /></td>
                  <td style={td()}><code style={{ fontSize: '0.74rem' }}>{e.audit_id}</code></td>
                  <td style={td()}>{timeAgo(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <AuditNote>Every custody transfer is co-signed and written to the immutable audit log (HL-12).</AuditNote>
        </Card>
      )}
    </div>
  );
}
