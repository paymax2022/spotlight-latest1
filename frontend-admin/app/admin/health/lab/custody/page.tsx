'use client';

import { useEffect, useState } from 'react';
import { listCustody, getCustodyChain, flagCustodyBreak } from '@/services/healthLabAdminService';
import type { CustodySample, CustodyChain } from '@/types/healthLabAdmin';
import { LabTabs, DisclosureNote, AuditNote, StateBlock, FilterBar, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'collected', 'in_custody', 'handed_over', 'accessioned', 'breached', 'recollect_required'];

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(reject|fail|block|suspend|breach|recollect)/.test(v)) return colors.danger;
  if (/(pending|flag|hold|warn)/.test(v)) return colors.warning;
  if (/(approve|active|verified|complete|release|resolve|paid|ok|intact|accession|handed)/.test(v)) return colors.success;
  return colors.info;
}

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
    <Page>
      <PageHeader title="Chain-of-custody oversight" subtitle="Track every sample from collection to accession on an immutable custody log. Any break forces recollection — no result is released on a broken chain (HL-6)." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="custody" />

      <DisclosureNote>
        HL-6 — chain-of-custody integrity. Each sample carries a tamper-evident seal and cold-chain log
        (COLLECTED → IN_CUSTODY → HANDED_OVER → ACCESSIONED). A break (seal broken, temperature excursion,
        custody gap) marks the chain BROKEN → RECOLLECT_REQUIRED; the result pipeline is blocked until a fresh
        sample is collected. All custody events are written to the immutable audit log (HL-12).
      </DisclosureNote>

      {breaks > 0 && (
        <div style={{ border: `1px solid ${tint(colors.danger, 0.35)}`, background: tint(colors.danger, 0.08), color: colors.danger, borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem', fontWeight: 600 }}>
          {breaks} sample{breaks > 1 ? 's' : ''} with a broken chain in view — recollection required (HL-6). Results are blocked for these.
        </div>
      )}

      <FilterBar>
        <div>
          <label>Custody status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label>Chain</label>
          <select value={chain} onChange={(e) => setChain(e.target.value)}>
            <option value="">All</option>
            <option value="broken">Broken only</option>
            <option value="intact">Intact only</option>
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Patient, lab, order ref, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No samples match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Sample</th><th style={thCell}>Order</th><th style={thCell}>Patient</th>
                <th style={thCell}>Test</th><th style={thCell}>Phlebotomist</th><th style={thCell}>Chain</th>
                <th style={thCell}>Status</th><th style={thCell}>Updated</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={!r.chain_intact ? { background: tint(colors.danger, 0.06) } : undefined}>
                    <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                    <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.order_ref}</code></td>
                    <td style={tdCell}>{r.patient_masked}</td>
                    <td style={tdCell}>{r.test_summary}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.lab_masked}</div></td>
                    <td style={tdCell}>{r.phlebotomist_masked}</td>
                    <td style={tdCell}><Badge text={r.chain_intact ? 'intact' : 'broken'} color={r.chain_intact ? colors.success : colors.danger} />{r.break_reason ? <div style={{ fontSize: '0.72rem', color: colors.danger, marginTop: 2, maxWidth: 280 }}>{r.break_reason}</div> : null}</td>
                    <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} /></td>
                    <td style={tdCell}>{timeAgo(r.updated_at)}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Button variant="outline" sm onClick={() => viewChain(r.id)}>Chain</Button>
                        {r.chain_intact && <Button variant="danger" sm disabled={busy} onClick={() => flagBreak(r.id)}>Flag break</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>

      {chainLoading && <p style={{ color: colors.muted }}>Loading chain…</p>}
      {open && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>Custody chain — {open.id}</h2>
            <Button variant="outline" sm onClick={() => setOpen(null)}>Close</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: colors.muted }}>Order:</span> {open.order_ref}</div>
            <div><span style={{ color: colors.muted }}>Patient:</span> {open.patient_masked}</div>
            <div><span style={{ color: colors.muted }}>Test:</span> {open.test_summary}</div>
            <div><span style={{ color: colors.muted }}>Chain:</span> <Badge text={open.chain_intact ? 'intact' : 'broken'} color={open.chain_intact ? colors.success : colors.danger} /></div>
          </div>
          {!open.chain_intact && (
            <div style={{ border: `1px solid ${tint(colors.danger, 0.35)}`, background: tint(colors.danger, 0.08), color: colors.danger, borderRadius: '0.5rem', padding: '0.5rem 0.7rem', fontSize: '0.8rem', marginBottom: '1rem', fontWeight: 600 }}>
              Broken chain — recollection mandated. No result will be released on this sample (HL-6).
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Step</th><th style={thCell}>Detail</th><th style={thCell}>Actor</th><th style={thCell}>Location</th><th style={thCell}>Temp</th><th style={thCell}>Seal</th><th style={thCell}>Audit</th><th style={thCell}>When</th></tr></thead>
            <tbody>
              {open.events.map((e) => (
                <tr key={e.id} style={e.step === 'BREACHED' || e.step === 'RECOLLECT_REQUIRED' ? { background: tint(colors.danger, 0.06) } : undefined}>
                  <td style={tdCell}><Badge text={e.step.replace(/_/g, ' ')} color={statusColor(e.step)} /></td>
                  <td style={tdCell}>{e.label}</td>
                  <td style={tdCell}>{e.actor_masked}</td>
                  <td style={tdCell}>{e.location}</td>
                  <td style={tdCell}>{e.temperature_c == null ? '—' : `${e.temperature_c}°C`}</td>
                  <td style={tdCell}><Badge text={e.seal_intact ? 'intact' : 'broken'} color={e.seal_intact ? colors.success : colors.danger} /></td>
                  <td style={tdCell}><code style={{ fontSize: '0.74rem' }}>{e.audit_id}</code></td>
                  <td style={tdCell}>{timeAgo(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <AuditNote>Every custody transfer is co-signed and written to the immutable audit log (HL-12).</AuditNote>
        </Card>
      )}
    </Page>
  );
}
