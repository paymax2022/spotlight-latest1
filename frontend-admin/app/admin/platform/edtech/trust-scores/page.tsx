'use client';

// SU-07 — School Trust Score Admin. View component breakdown; override with a
// mandatory reason where a computed score is disputed. RBAC: platform_edtech_admin.

import { useEffect, useState } from 'react';
import { listTrustScores, overrideTrustScore } from '@/services/platformEdtechAdminService';
import type { TrustScoreRow } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, fmtDate,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote, Bar, btn, btnPrimary, input, label,
} from '../_ui';

export default function TrustScorePage() {
  const [rows, setRows] = useState<TrustScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { score: string; reason: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listTrustScores()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function f(id: string) { return form[id] ?? { score: '', reason: '' }; }

  async function override(r: TrustScoreRow) {
    const cur = f(r.school_id);
    const score = Number(cur.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) { setNotice('Score must be 0–100.'); return; }
    if (!cur.reason.trim()) { setNotice('An override reason is required (audited).'); return; }
    setBusy(r.school_id); setNotice(null);
    try { const u = await overrideTrustScore({ school_id: r.school_id, score, reason: cur.reason }); setNotice(`${r.school_name} trust score → ${u.score} (overridden).`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="School Trust Score Admin" subtitle="Audit each school's trust-score components and, where a computation is disputed, override the score with a recorded reason." action={<button onClick={load} style={btn()}>Refresh</button>} />
        <PlatformTabs active="trust-scores" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. Trust score gates escrow custody + competition eligibility alongside verification tier. Overrides are rare and always audited.</DisclosureNote>
        {notice ? <div style={{ marginBottom: '1rem', color: '#5b21b6' }}>{notice}</div> : null}

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Schools scored" value={rows.length.toString()} accent="#340075" />
            <Kpi label="Avg trust score" value={rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length).toString() : '—'} />
            <Kpi label="Overridden" value={rows.filter((r) => r.overridden).length.toString()} accent="#9a3412" />
          </div>

          {rows.map((r) => (
            <Card key={r.school_id} title={r.school_name} right={<span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>{r.overridden ? <Badge status="warn" label="overridden" /> : null}<strong style={{ fontSize: '1.2rem', color: r.score >= 75 ? '#15803d' : r.score >= 50 ? '#9a3412' : '#b91c1c' }}>{r.score}</strong></span>}>
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                {r.components.map((c) => <Bar key={c.label} value={c.value} max={100} labelLeft={`${c.label} (${Math.round(c.weight * 100)}%)`} labelRight={String(c.value)} />)}
              </div>
              {r.overridden ? <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#9a3412' }}>Override reason: {r.override_reason} · {fmtDate(r.updated_at)}</div> : null}
              <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '0.75rem', paddingTop: '0.75rem', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.6rem', alignItems: 'end' }}>
                <div><span style={label()}>New score (0–100)</span><input style={{ ...input(), width: 100 }} value={f(r.school_id).score} onChange={(e) => setForm({ ...form, [r.school_id]: { ...f(r.school_id), score: e.target.value } })} /></div>
                <div><span style={label()}>Override reason (required, audited)</span><input style={input()} value={f(r.school_id).reason} onChange={(e) => setForm({ ...form, [r.school_id]: { ...f(r.school_id), reason: e.target.value } })} /></div>
                <button onClick={() => override(r)} disabled={busy === r.school_id} style={btnPrimary()}>Override</button>
              </div>
              <AuditNote>Trust-score overrides are written to the immutable audit trail with operator + reason.</AuditNote>
            </Card>
          ))}
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
