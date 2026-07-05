'use client';

import { useEffect, useState } from 'react';
import { listCatalog, governTest, formatNaira } from '@/services/healthLabAdminService';
import type { LabCatalogItem, LabCatalogGovernanceAction } from '@/types/healthLabAdmin';
import { PageHeader, LabTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label } from '../../_ui';

const STATUSES = ['', 'pending', 'approved', 'rejected', 'suspended'];
const CATEGORIES = ['', 'haematology', 'chemistry', 'microbiology', 'serology', 'molecular', 'panel'];

export default function LabCatalogPage() {
  const [rows, setRows] = useState<LabCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCatalog({ status: status || undefined, category: category || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, category]);

  async function govern(id: string, action: LabCatalogGovernanceAction) {
    setBusy(true); setMsg(null);
    try { const r = await governTest(id, action); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Test catalog governance" subtitle="Govern test & package definitions — LOINC mapping, specimen, prep and turnaround. Untyped/unmapped tests are held for review before listing." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LabTabs active="catalog" />

      <DisclosureNote>
        Tests must carry a governed definition (LOINC code, specimen, prep, TAT) before they are listed. Items
        from suspended labs are blocked (HL-2). Prices shown in ₦ (kobo internally). Governance decisions are
        recorded to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Category</label>
          <select style={select()} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c ? c : 'All categories'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Test name, LOINC, lab, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No catalog items match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Test</th><th style={th()}>LOINC</th><th style={th()}>Category</th>
              <th style={th()}>Specimen / prep</th><th style={th()}>TAT</th><th style={th()}>Price</th>
              <th style={th()}>Lab</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.test_name}</strong>{r.is_package ? <Badge status="otc" label="package" /> : null}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}>{r.loinc_code ? <code style={{ fontSize: '0.76rem' }}>{r.loinc_code}</code> : <Badge status="flagged" label="no LOINC" />}</td>
                  <td style={td()}>{r.category}</td>
                  <td style={td()}>{r.specimen}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.prep_required}</div></td>
                  <td style={td()}>{r.tat_hours}h</td>
                  <td style={td()}>{formatNaira(r.price_kobo)}</td>
                  <td style={td()}>{r.lab_masked}</td>
                  <td style={td()}><Badge status={r.status} />{r.flagged_reason ? <div style={{ fontSize: '0.72rem', color: '#b91c1c', marginTop: 2 }}>{r.flagged_reason}</div> : null}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button disabled={busy} style={btnPrimary()} onClick={() => govern(r.id, 'approve')}>Approve</button>
                      <button disabled={busy} style={btn()} onClick={() => govern(r.id, 'suspend')}>Suspend</button>
                      <button disabled={busy} style={btnDanger()} onClick={() => govern(r.id, 'reject')}>Reject</button>
                    </div>
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
