'use client';

import { useEffect, useState } from 'react';
import { listCatalog, governTest, formatNaira } from '@/services/healthLabAdminService';
import type { LabCatalogItem, LabCatalogGovernanceAction } from '@/types/healthLabAdmin';
import { LabTabs, DisclosureNote, AuditNote, StateBlock, FilterBar } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'pending', 'approved', 'rejected', 'suspended'];
const CATEGORIES = ['', 'haematology', 'chemistry', 'microbiology', 'serology', 'molecular', 'panel'];

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(reject|fail|block|suspend|breach|critical|invalid|no loinc)/.test(v)) return colors.danger;
  if (/(pending|flag|hold|warn)/.test(v)) return colors.warning;
  if (/(approve|active|verified|complete|release|resolve|paid|ok)/.test(v)) return colors.success;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Test catalog governance" subtitle="Govern test & package definitions — LOINC mapping, specimen, prep and turnaround. Untyped/unmapped tests are held for review before listing." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="catalog" />

      <DisclosureNote>
        Tests must carry a governed definition (LOINC code, specimen, prep, TAT) before they are listed. Items
        from suspended labs are blocked (HL-2). Prices shown in ₦ (kobo internally). Governance decisions are
        recorded to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c ? c : 'All categories'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Test name, LOINC, lab, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No catalog items match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Test</th><th style={thCell}>LOINC</th><th style={thCell}>Category</th>
                <th style={thCell}>Specimen / prep</th><th style={thCell}>TAT</th><th style={thCell}>Price</th>
                <th style={thCell}>Lab</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><strong>{r.test_name}</strong>{r.is_package ? <Badge text="package" color={colors.secondary} /> : null}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                    <td style={tdCell}>{r.loinc_code ? <code style={{ fontSize: '0.76rem' }}>{r.loinc_code}</code> : <Badge text="no LOINC" color={colors.warning} />}</td>
                    <td style={tdCell}>{r.category}</td>
                    <td style={tdCell}>{r.specimen}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.prep_required}</div></td>
                    <td style={tdCell}>{r.tat_hours}h</td>
                    <td style={tdCell}>{formatNaira(r.price_kobo)}</td>
                    <td style={tdCell}>{r.lab_masked}</td>
                    <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} />{r.flagged_reason ? <div style={{ fontSize: '0.72rem', color: colors.danger, marginTop: 2 }}>{r.flagged_reason}</div> : null}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Button variant="primary" sm disabled={busy} onClick={() => govern(r.id, 'approve')}>Approve</Button>
                        <Button variant="outline" sm disabled={busy} onClick={() => govern(r.id, 'suspend')}>Suspend</Button>
                        <Button variant="danger" sm disabled={busy} onClick={() => govern(r.id, 'reject')}>Reject</Button>
                      </div>
                    </td>
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
