'use client';

// A6 — Merit ledger + integrity/audit viewer. RBAC: arena.auditor.read (Auditor)
// / arena.admin.manage. READ-ONLY — no write path. This is the anti-rigging
// trust surface: browse signed, hash-chained Merit entries by contestant/stage,
// verify signatures + chain integrity, export for FRSC/regulator (NDC-6).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCompetitions, listMerit, verifyMerit } from '@/services/arenaAdminService';
import type { Competition, MeritEntry, MeritVerifyResult, MeritStage } from '@/types/arenaAdmin';
import { MERIT_STAGE_LABELS } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, timeAgo, PermissionBanner, ARENA_PERMS, useArenaPermission,
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
    <Page>
      <PageHeader
        title="Arena — Merit Ledger & Integrity (A6)"
        subtitle="Append-only, signed, hash-chained Merit entries — the anti-rigging trust surface. READ-ONLY. RBAC: arena.auditor.read."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.auditor} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.info, marginBottom: '1.25rem' }}>
        Every entry is signed by an authorized ScoringGateway adapter (NDC-2) and chained by <code>entry_hash</code> to its predecessor per contestant, so the ledger is tamper-evident. Corrections are append-only compensating entries — never edits.
      </div>

      <Card title="Filters & actions" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Contestant
            <select value={contestantFilter} onChange={(e) => setContestantFilter(e.target.value)}>
              <option value="">All</option>
              {contestants.map((cid) => <option key={cid} value={cid}>{cid}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Stage
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as MeritStage | '')}>
              <option value="">All</option>
              {(Object.keys(MERIT_STAGE_LABELS) as MeritStage[]).map((s) => <option key={s} value={s}>{MERIT_STAGE_LABELS[s]}</option>)}
            </select>
          </label>
          <Button variant="primary" onClick={() => void runVerify()} disabled={verifying}>
            {verifying ? 'Verifying…' : 'Verify integrity'}
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>
        </div>

        {verifyResult && (
          <div style={{ marginTop: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: '0.5rem', background: verifyResult.chain_valid && verifyResult.signatures_valid ? tint(colors.success, 0.12) : tint(colors.danger, 0.12), border: `1px solid ${verifyResult.chain_valid && verifyResult.signatures_valid ? tint(colors.success, 0.35) : tint(colors.danger, 0.35)}`, fontSize: '0.85rem', color: verifyResult.chain_valid && verifyResult.signatures_valid ? colors.success : colors.danger }}>
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
          <p style={{ color: colors.muted }}>Loading ledger…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: colors.muted }}>No Merit entries for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Contestant</th>
                  <th style={thCell}>Stage</th>
                  <th style={thCell}>Source</th>
                  <th style={thCell}>Norm. score</th>
                  <th style={thCell}>Rubric</th>
                  <th style={thCell}>Signature</th>
                  <th style={thCell}>Chain (prev → entry)</th>
                  <th style={thCell}>Signed</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...tdCell, ...mono() }}>{e.contestant_id}</td>
                    <td style={tdCell}><Badge text={MERIT_STAGE_LABELS[e.stage] ?? e.stage} color={colors.secondary} /></td>
                    <td style={tdCell}>{e.source_type}</td>
                    <td style={{ ...tdCell, fontWeight: 600 }}>{e.normalized_score.toFixed(1)}</td>
                    <td style={{ ...tdCell, ...mono() }}>{e.rubric_version ?? '—'}</td>
                    <td style={{ ...tdCell, ...mono(), color: colors.success }} title={e.signature}>🔏 {truncate(e.signature)}</td>
                    <td style={{ ...tdCell, ...mono() }}>
                      <span style={{ color: colors.muted }}>{e.prev_hash ? truncate(e.prev_hash) : 'genesis'}</span>
                      {' → '}
                      <span>{truncate(e.entry_hash)}</span>
                    </td>
                    <td style={tdCell}>{timeAgo(e.signed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}

function truncate(s: string): string {
  return s.length > 16 ? `${s.slice(0, 14)}…` : s;
}
