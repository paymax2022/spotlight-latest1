'use client';

// SC-38 · Government Export Center (SF-11).
// Opt-in per data category, per school. Every export is logged immutably in the
// ComplianceExport audit trail — the log is append-only and never edited.

import { useEffect, useMemo, useState } from 'react';
import {
  listFeesSchools, listGovOptIns, setGovOptIn,
  listComplianceExports, generateComplianceExport, DATA_CATEGORIES,
} from '@/services/academyFeesService';
import type { FeesSchool, GovExportOptIn, ComplianceExport, DataCategory } from '@/types/academyFees';
import {
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, th, td, input, label, select, fmtDate, timeAgo,
} from '../../_ui';
import { FeesTabs } from '../_ui';

export default function FeesGovExportPage() {
  const [schools, setSchools] = useState<FeesSchool[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [optIns, setOptIns] = useState<GovExportOptIn[]>([]);
  const [exports, setExports] = useState<ComplianceExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [exportForm, setExportForm] = useState<{ report_type: string; recipient: string; period: string; cats: DataCategory[] }>({ report_type: '', recipient: '', period: '', cats: [] });

  async function loadSchools() {
    const s = await listFeesSchools(); setSchools(s);
    if (s[0]) setSchoolId((cur) => cur || s[0].id);
  }
  async function loadFor(id: string) {
    if (!id) return;
    setLoading(true); setError(null);
    try { const [o, e] = await Promise.all([listGovOptIns(id), listComplianceExports(id)]); setOptIns(o); setExports(e); }
    catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadSchools().catch((e) => setError(String(e))); }, []);
  useEffect(() => { if (schoolId) loadFor(schoolId); }, [schoolId]);

  const optInMap = useMemo(() => Object.fromEntries(optIns.map((o) => [o.category, o.opted_in])), [optIns]);
  const optedCats = useMemo(() => DATA_CATEGORIES.filter((c) => optInMap[c.key]), [optInMap]);

  async function toggle(cat: DataCategory, next: boolean) {
    setBusy(cat); setNotice(null);
    try { await setGovOptIn({ school_id: schoolId, category: cat, opted_in: next }); setNotice(`${cat} export ${next ? 'opted in' : 'opted out'}.`); await loadFor(schoolId); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  function toggleCat(cat: DataCategory) {
    setExportForm((f) => ({ ...f, cats: f.cats.includes(cat) ? f.cats.filter((c) => c !== cat) : [...f.cats, cat] }));
  }
  async function generate() {
    if (!exportForm.report_type || !exportForm.recipient || !exportForm.period || exportForm.cats.length === 0) { setNotice('Report type, recipient, period and at least one category are required.'); return; }
    const notOpted = exportForm.cats.filter((c) => !optInMap[c]);
    if (notOpted.length) { setNotice(`Cannot export non-opted-in categories: ${notOpted.join(', ')} (SF-11).`); return; }
    setBusy('gen'); setNotice(null);
    try { const e = await generateComplianceExport({ school_id: schoolId, report_type: exportForm.report_type, recipient: exportForm.recipient, period: exportForm.period, data_categories: exportForm.cats }); setNotice(`Generated & logged export "${e.report_type}" → ${e.recipient}.`); setExportForm({ report_type: '', recipient: '', period: '', cats: [] }); await loadFor(schoolId); }
    catch (err) { setNotice(String(err)); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Government Export Center" subtitle="Opt in per data category, then generate regulator/government reports. Every export is written to an immutable, append-only audit trail." action={<button onClick={() => loadFor(schoolId)} style={btn()}>Refresh</button>} />
      <FeesTabs active="gov-export" />
      <DisclosureNote>Requires <code>academy.fees.export</code>. <strong>SF-11:</strong> government/regulator sync is <strong>opt-in per school, per data category</strong>, and every export is <strong>logged immutably</strong>. A category that is not opted in cannot be exported.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <Card title="School" >
          <select style={{ ...select(), maxWidth: 340 }} value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Categories opted in" value={`${optedCats.length} / ${DATA_CATEGORIES.length}`} accent="#340075" />
          <Kpi label="Exports logged" value={exports.length.toString()} />
          <Kpi label="Last export" value={exports[0] ? timeAgo(exports[0].generated_at) : '—'} />
        </div>

        <Card title="Data-category opt-in (SF-11)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Data category</th><th style={th()}>Status</th><th style={th()}>Updated</th><th style={th()}>Action</th></tr></thead>
            <tbody>
              {DATA_CATEGORIES.map((c) => {
                const on = Boolean(optInMap[c.key]);
                const row = optIns.find((o) => o.category === c.key);
                return (
                  <tr key={c.key}>
                    <td style={td()}><strong>{c.label}</strong> <code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.key}</code></td>
                    <td style={td()}><Badge status={on ? 'approved' : 'inactive'} label={on ? 'opted in' : 'opted out'} /></td>
                    <td style={td()}>{row ? fmtDate(row.updated_at) : '—'}</td>
                    <td style={td()}><button onClick={() => toggle(c.key, !on)} disabled={busy === c.key} style={on ? btn() : btnPrimary()}>{on ? 'Opt out' : 'Opt in'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Generate export">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Report type</label><input style={input()} value={exportForm.report_type} onChange={(e) => setExportForm({ ...exportForm, report_type: e.target.value })} placeholder="Enrolment return" /></div>
            <div><label style={label()}>Recipient body</label><input style={input()} value={exportForm.recipient} onChange={(e) => setExportForm({ ...exportForm, recipient: e.target.value })} placeholder="State SUBEB" /></div>
            <div><label style={label()}>Period</label><input style={input()} value={exportForm.period} onChange={(e) => setExportForm({ ...exportForm, period: e.target.value })} placeholder="2025 Q3" /></div>
          </div>
          <div style={{ marginTop: '0.7rem' }}>
            <label style={label()}>Data categories (opted-in only)</label>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              {DATA_CATEGORIES.map((c) => {
                const disabled = !optInMap[c.key];
                return (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem', color: disabled ? '#9ca3af' : '#374151' }}>
                    <input type="checkbox" disabled={disabled} checked={exportForm.cats.includes(c.key)} onChange={() => toggleCat(c.key)} /> {c.label}{disabled ? ' (not opted in)' : ''}
                  </label>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: '0.7rem' }}><button onClick={generate} disabled={busy === 'gen'} style={btnPrimary()}>Generate & log export</button></div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
        </Card>

        <Card title="Compliance export log (append-only)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Report</th><th style={th()}>Recipient</th><th style={th()}>Categories</th><th style={th()}>Period</th><th style={th()}>By</th><th style={th()}>Generated</th></tr></thead>
            <tbody>
              {exports.map((e) => <tr key={e.id}><td style={td()}><strong>{e.report_type}</strong></td><td style={td()}>{e.recipient}</td><td style={td()}>{e.data_categories.map((c) => <span key={c} style={{ marginRight: 4 }}><Badge status="core" label={c} /></span>)}</td><td style={td()}>{e.period}</td><td style={td()}>{e.generated_by}</td><td style={td()}>{fmtDate(e.generated_at)}</td></tr>)}
              {exports.length === 0 && <tr><td style={td()} colSpan={6}><span style={{ color: '#6b7280' }}>No exports logged for this school.</span></td></tr>}
            </tbody>
          </table>
          <AuditNote>The ComplianceExport log is append-only and immutable (SF-11) — records are written to the audit log (module <code>academy.fees</code>) and never edited or deleted.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
