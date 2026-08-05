'use client';

import { useEffect, useState } from 'react';
import { listEprescriptionAudit } from '@/services/healthVetAdminService';
import type { EprescriptionAuditItem } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, btnPrimary, th, td, input, select, label, fmtDate } from '../../_ui';
import { colors, tint } from '@/components/ui/vuexy';

const STATUSES = ['', 'issued', 'sent_to_pharmacy', 'verifying', 'verified', 'dispensed', 'fulfilled', 'rejected'];

export default function EprescriptionAuditPage() {
  const [rows, setRows] = useState<EprescriptionAuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [pom, setPom] = useState('');
  const [flagged, setFlagged] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listEprescriptionAudit({ status: status || undefined, pom: pom || undefined, flagged: flagged || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, pom, flagged]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="E-prescription audit" subtitle="Audit every e-Rx issued from a vet consult: POM gating, dispense-once enforcement and prescriber VCN traceability (HL-3). Controlled substances are excluded at MVP (HL-4)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <VetTabs active="eprescription-audit" />

      <DisclosureNote>
        HL-3 — a POM e-Rx must be issued by a verified VCN-licensed vet, and DISPENSED is terminal-once: a
        prescription can never be filled twice (dispense-once enforced server-side). The prescriber VCN licence
        number is surfaced for traceability. Controlled substances are excluded at MVP (HL-4). Owner data is
        NDPA-masked (HL-8). Every audit record links to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>POM</label>
          <select style={select()} value={pom} onChange={(e) => setPom(e.target.value)}>
            <option value="">All</option>
            <option value="yes">POM only</option>
          </select>
        </div>
        <div>
          <label style={label()}>Flagged</label>
          <select style={select()} value={flagged} onChange={(e) => setFlagged(e.target.value)}>
            <option value="">All</option>
            <option value="yes">Flagged only</option>
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Pet, vet, VCN no, drug, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No e-prescriptions match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Drug / pet</th><th style={th()}>Prescriber (VCN)</th><th style={th()}>Class</th>
              <th style={th()}>Dispense-once</th><th style={th()}>Issued</th><th style={th()}>Dispensed</th>
              <th style={th()}>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.flagged ? { background: tint(colors.warning, 0.08) } : undefined}>
                  <td style={td()}><strong>{r.drug_summary}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.pet_name} ({r.pet_species}) · {r.owner_masked} · {r.id}</div>{r.flagged && r.flag_reason ? <div style={{ fontSize: '0.72rem', color: colors.danger, marginTop: 3 }}>{r.flag_reason}</div> : null}</td>
                  <td style={td()}>{r.vet_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}><code>{r.vcn_licence_no}</code></div></td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {r.is_pom ? <Badge status="pom" label="POM" /> : <Badge status="otc" label="OTC" />}
                      {r.is_controlled ? <Badge status="controlled" label="controlled" /> : null}
                    </div>
                  </td>
                  <td style={td()}><Badge status={r.dispense_once_ok ? 'ok' : 'blocked'} label={r.dispense_once_ok ? 'enforced' : 'duplicate blocked'} /></td>
                  <td style={td()}>{fmtDate(r.issued_at)}</td>
                  <td style={td()}>{fmtDate(r.dispensed_at)}</td>
                  <td style={td()}><Badge status={r.status} />{r.flagged ? <div style={{ marginTop: 3 }}><Badge status="flagged" label="flagged" /></div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
