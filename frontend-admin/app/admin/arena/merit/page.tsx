'use client';

// A6 — Merit ledger + integrity/audit viewer. RBAC: arena.auditor.read (Auditor)
// / arena.admin.manage. READ-ONLY — no write path. This is the anti-rigging
// trust surface: browse signed, hash-chained Merit entries by contestant/stage,
// verify signatures + chain integrity, export for FRSC/regulator (NDC-6).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCompetitions, listMerit, verifyMerit } from '@/services/arenaAdminService';
import type { Competition, MeritEntry, MeritVerifyResult, MeritStage } from '@/types/arenaAdmin';
import { MERIT_STAGE_LABELS } from '@/types/arenaAdmin';
import {
  PageHeader, Card, btn, btnPrimary, th, td, selectStyle, mono,
  timeAgo, Pill, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

export default function ArenaMeritPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.auditor, ARENA_PERMS.admin);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [rows, setRows] = useState<MeritEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [contestantFilter, setContestantFilter] = useState('');
  const [stageFilter, setStageFilter] = useState<MeritStage | ''>('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<MeritVerifyResult | null>(null);

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null); setVerifyResult(null);
    try {
      const entries = await listMerit(competitionId);
      entries.sort((a, b) => new Date(a.signed_at).getTime() - new Date(b.signed_at).getTime());
      setRows(entries);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  const contestants = useMemo(() => Array.from(new Set(rows.map((r) => r.contestant_id))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) =>
    (!contestantFilter || r.contestant_id === contestantFilter) &&
    (!stageFilter || r.stage === stageFilter),
  ), [rows, contestantFilter, stageFilter]);

  const runVerify = useCallback(async () => {
    setVerifying(true); setError(null);
    try { setVerifyResult(await verifyMerit(competitionId, contestantFilter || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setVerifying(false); }
  }, [competitionId, contestantFilter]);

  const exportCsv = useCallback(() => {
    const header = ['id', 'contestant_id', 'stage', 'source_type', 'source_adapter_id', 'rubric_version', 'raw_score', 'normalized_score', 'signature', 'entry_hash', 'prev_hash', 'signed_at'];
    const lines = [header.join(',')].concat(
      filtered.map((r) => header.map((k) => JSON.stringify((r as unknown as Record<string, unknown>)[k] ?? '')).join(',')),
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `merit-ledger-${competitionId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [filtered, competitionId]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Merit Ledger & Integrity (A6)"
        subtitle="Append-only, signed, hash-chained Merit entries — the anti-rigging trust surface. READ-ONLY. RBAC: arena.auditor.read."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.auditor} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#1e40af', marginBottom: '1.25rem' }}>
        Every entry is signed by an authorized ScoringGateway adapter (NDC-2) and chained by <code>entry_hash</code> to its predecessor per contestant, so the ledger is tamper-evident. Corrections are append-only compensating entries — never edits.
      </div>

      <Card title="Filters & actions">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Contestant
            <select value={contestantFilter} onChange={(e) => setContestantFilter(e.target.value)} style={selectStyle()}>
              <option value="">All</option>
              {contestants.map((cid) => <option key={cid} value={cid}>{cid}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Stage
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as MeritStage | '')} style={selectStyle()}>
              <option value="">All</option>
              {(Object.keys(MERIT_STAGE_LABELS) as MeritStage[]).map((s) => <option key={s} value={s}>{MERIT_STAGE_LABELS[s]}</option>)}
            </select>
          </label>
          <button onClick={() => void runVerify()} style={btnPrimary('#15803d')} disabled={verifying}>
            {verifying ? 'Verifying…' : 'Verify integrity'}
          </button>
          <button onClick={exportCsv} style={btn()} disabled={!filtered.length}>Export CSV</button>
        </div>

        {verifyResult && (
          <div style={{ marginTop: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: '0.5rem', background: verifyResult.chain_valid && verifyResult.signatures_valid ? '#f0fdf4' : '#fef2f2', border: `1px solid ${verifyResult.chain_valid && verifyResult.signatures_valid ? '#bbf7d0' : '#fca5a5'}`, fontSize: '0.85rem', color: verifyResult.chain_valid && verifyResult.signatures_valid ? '#166534' : '#b91c1c' }}>
            <strong>{verifyResult.chain_valid && verifyResult.signatures_valid ? '✓ Integrity proof valid' : '✗ Integrity check failed'}</strong>
            {' — '}{verifyResult.entries_checked} entr{verifyResult.entries_checked === 1 ? 'y' : 'ies'} checked
            {verifyResult.contestant_id ? ` for ${verifyResult.contestant_id}` : ' (all contestants)'}.
            {' Signatures: '}{verifyResult.signatures_valid ? 'valid' : 'INVALID'}; chain: {verifyResult.chain_valid ? 'intact' : `BROKEN at ${verifyResult.broken_at}`}.
            {' Verified '}{timeAgo(verifyResult.verified_at)}.
          </div>
        )}
      </Card>

      <Card title="Merit entries">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading ledger…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No Merit entries for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Contestant</th>
                  <th style={th()}>Stage</th>
                  <th style={th()}>Source</th>
                  <th style={th()}>Norm. score</th>
                  <th style={th()}>Rubric</th>
                  <th style={th()}>Signature</th>
                  <th style={th()}>Chain (prev → entry)</th>
                  <th style={th()}>Signed</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...td(), ...mono() }}>{e.contestant_id}</td>
                    <td style={td()}><Pill fg="#374151" bg="#f3f4f6">{MERIT_STAGE_LABELS[e.stage] ?? e.stage}</Pill></td>
                    <td style={td()}>{e.source_type}</td>
                    <td style={{ ...td(), fontWeight: 600 }}>{e.normalized_score.toFixed(1)}</td>
                    <td style={{ ...td(), ...mono() }}>{e.rubric_version ?? '—'}</td>
                    <td style={{ ...td(), ...mono(), color: '#15803d' }} title={e.signature}>🔏 {truncate(e.signature)}</td>
                    <td style={{ ...td(), ...mono() }}>
                      <span style={{ color: '#9ca3af' }}>{e.prev_hash ? truncate(e.prev_hash) : 'genesis'}</span>
                      {' → '}
                      <span>{truncate(e.entry_hash)}</span>
                    </td>
                    <td style={td()}>{timeAgo(e.signed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function truncate(s: string): string {
  return s.length > 16 ? `${s.slice(0, 14)}…` : s;
}
