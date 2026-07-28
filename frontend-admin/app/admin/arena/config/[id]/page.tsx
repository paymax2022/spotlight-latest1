'use client';

// A1 — Competition config detail. Configure rails (Merit sources, Support params,
// Play-Along thresholds, Sponsor slots) + award→rail bindings, set schema/rubric
// versions, validate, publish (immutable version). RBAC: arena.admin.manage.
//
// NDC-1 (LOCKED): the NAIJA_DRIVER_CROWN←Merit binding is shown non-editable.
// Money/engagement rails can NEVER be bound to the crown.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { getCompetition, getCompetitionConfig, publishConfig } from '@/services/arenaAdminService';
import type { Competition, CompetitionConfig, RailConfig, AwardBinding, RailKind, AwardCode } from '@/types/arenaAdmin';
import { RAIL_LABELS, AWARD_LABELS } from '@/types/arenaAdmin';
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, selectStyle, mono,
  CompetitionStatusBadge, LockedChip, AuditNote, PermissionBanner, BackToArena,
  ARENA_PERMS, useArenaPermission,
} from '../../_ui';

// Which rails a given award is *allowed* to bind to. The crown is Merit-only
// (NDC-1); this is mirrored server-side and non-editable here.
const ALLOWED_RAILS: Record<AwardCode, RailKind[]> = {
  NAIJA_DRIVER_CROWN: ['MERIT'],
  PEOPLES_CHAMPION: ['SUPPORT'],
  STATE_PRIDE_WINNER: ['SUPPORT'],
  CERTIFIED_SAFE_DRIVER: ['PLAY_ALONG', 'SPONSOR'],
};

export default function ArenaConfigDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { allowed } = useArenaPermission(ARENA_PERMS.admin);

  const [competition, setCompetition] = useState<Competition | null>(null);
  const [config, setConfig] = useState<CompetitionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [comp, cfg] = await Promise.all([getCompetition(id), getCompetitionConfig(id)]);
      setCompetition(comp); setConfig(cfg);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { if (id) void load(); }, [id, load]);

  const setRail = useCallback((kind: RailKind, patch: Partial<RailConfig>) => {
    setConfig((c) => c && ({ ...c, rails: c.rails.map((r) => (r.kind === kind ? { ...r, ...patch } : r)) }));
  }, []);

  const setBinding = useCallback((award: AwardCode, rail: RailKind) => {
    setConfig((c) => c && ({ ...c, award_bindings: c.award_bindings.map((b) => (b.award === award ? { ...b, rail } : b)) }));
  }, []);

  // Validate: crown must bind Merit & be locked; no money/engagement rail on crown.
  const validate = useCallback((cfg: CompetitionConfig): string[] => {
    const errs: string[] = [];
    const crown = cfg.award_bindings.find((b) => b.award === 'NAIJA_DRIVER_CROWN');
    if (!crown) errs.push('Missing NAIJA_DRIVER_CROWN award binding.');
    else if (crown.rail !== 'MERIT') errs.push('NDC-1 violation: the crown must bind to Merit only.');
    else if (!crown.locked) errs.push('NDC-1: the crown←Merit binding must be locked.');
    for (const b of cfg.award_bindings) {
      const allowedRails = ALLOWED_RAILS[b.award] ?? [];
      if (allowedRails.length && !allowedRails.includes(b.rail)) {
        errs.push(`${AWARD_LABELS[b.award]} cannot bind to ${RAIL_LABELS[b.rail]}.`);
      }
    }
    if (!cfg.rubric_version.trim()) errs.push('Rubric version is required.');
    if (!cfg.screening_schema_version.trim()) errs.push('Screening schema version is required.');
    if (!cfg.exam_schema_version.trim()) errs.push('Exam schema version is required.');
    return errs;
  }, []);

  const runValidate = useCallback(() => {
    if (!config) return;
    const errs = validate(config);
    setValidationMsg(errs.length ? `Validation failed:\n• ${errs.join('\n• ')}` : 'Validation passed — configuration is publishable.');
  }, [config, validate]);

  const publish = useCallback(async () => {
    if (!config) return;
    const errs = validate(config);
    if (errs.length) { setValidationMsg(`Cannot publish:\n• ${errs.join('\n• ')}`); return; }
    if (!window.confirm('Publish creates an IMMUTABLE config version. Continue?')) return;
    setBusy(true); setError(null);
    try {
      const updated = await publishConfig(id, {
        rails: config.rails,
        award_bindings: config.award_bindings,
        screening_schema_version: config.screening_schema_version,
        rubric_version: config.rubric_version,
        exam_schema_version: config.exam_schema_version,
      });
      setConfig(updated);
      setValidationMsg(`Published as immutable config version ${updated.config_version}.`);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [config, id, validate, load]);

  const paramEntries = useMemo(() => (config?.rails ?? []).map((r) => [r.kind, Object.entries(r.params)] as const), [config]);

  if (loading) return <div style={{ padding: '1rem' }}><BackToArena /><p style={{ color: '#6b7280', marginTop: '1rem' }}>Loading config…</p></div>;
  if (error && !config) return <div style={{ padding: '1rem' }}><BackToArena /><p style={{ color: '#dc2626', marginTop: '1rem' }}>{error}</p></div>;
  if (!config) return null;

  const railParamsFor = (kind: RailKind) => paramEntries.find(([k]) => k === kind)?.[1] ?? [];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <div style={{ marginBottom: '0.75rem' }}><BackToArena /></div>
      <PageHeader
        title={competition ? competition.name : 'Competition config'}
        subtitle={`Slug: ${competition?.slug ?? id}. Configure rails + bindings, validate, publish. RBAC: arena.admin.manage.`}
        action={competition ? <CompetitionStatusBadge status={competition.status} /> : undefined}
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {config.published && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534', marginBottom: '1.25rem' }}>
          Published config version <strong>{config.config_version}</strong> is immutable. Publishing again creates a new version.
        </div>
      )}

      <Card title="Rails">
        <p style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: 0 }}>
          Four first-class channels. Merit is the only rail that may feed the crown — money (Support) and engagement (Play-Along/Sponsor) are firewalled from it.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Rail</th>
                <th style={th()}>Enabled</th>
                <th style={th()}>Parameters</th>
              </tr>
            </thead>
            <tbody>
              {config.rails.map((r) => (
                <tr key={r.kind}>
                  <td style={td()}><strong>{RAIL_LABELS[r.kind]}</strong></td>
                  <td style={td()}>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      disabled={!allowed}
                      onChange={(e) => setRail(r.kind, { enabled: e.target.checked })}
                    />
                  </td>
                  <td style={td()}>
                    {railParamsFor(r.kind).length === 0 ? (
                      <span style={{ color: '#9ca3af' }}>No params</span>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {railParamsFor(r.kind).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ ...mono(), color: '#6b7280', minWidth: 160 }}>{k}</span>
                            <input
                              value={String(v)}
                              disabled={!allowed}
                              onChange={(e) => setRail(r.kind, { params: { ...r.params, [k]: parseParam(v, e.target.value) } })}
                              style={{ ...inputStyle(), minWidth: 200 }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Award → rail bindings">
        <p style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: 0 }}>
          Each award draws from exactly one rail. The <strong>crown is bound to Merit and LOCKED</strong> (NDC-1) — it can never be made to accept money or engagement.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Award</th>
                <th style={th()}>Bound rail</th>
                <th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {config.award_bindings.map((b: AwardBinding) => {
                const railOptions = ALLOWED_RAILS[b.award] ?? (['MERIT', 'SUPPORT', 'PLAY_ALONG', 'SPONSOR'] as RailKind[]);
                const isCrown = b.award === 'NAIJA_DRIVER_CROWN';
                const locked = isCrown || b.locked;
                return (
                  <tr key={b.award}>
                    <td style={td()}><strong>{AWARD_LABELS[b.award]}</strong></td>
                    <td style={td()}>
                      {locked ? (
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          {RAIL_LABELS[b.rail]}
                        </span>
                      ) : (
                        <select
                          value={b.rail}
                          disabled={!allowed}
                          onChange={(e) => setBinding(b.award, e.target.value as RailKind)}
                          style={selectStyle()}
                        >
                          {railOptions.map((rk) => (
                            <option key={rk} value={rk}>{RAIL_LABELS[rk]}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={td()}>{locked ? <LockedChip label={isCrown ? 'NDC-1 · Merit-only' : 'LOCKED'} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Schema & rubric versions">
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Screening schema version
            <input value={config.screening_schema_version} disabled={!allowed} onChange={(e) => setConfig({ ...config, screening_schema_version: e.target.value })} style={inputStyle()} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Rubric version (Merit)
            <input value={config.rubric_version} disabled={!allowed} onChange={(e) => setConfig({ ...config, rubric_version: e.target.value })} style={inputStyle()} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: '#6b7280' }}>
            Exam schema version (theory)
            <input value={config.exam_schema_version} disabled={!allowed} onChange={(e) => setConfig({ ...config, exam_schema_version: e.target.value })} style={inputStyle()} />
          </label>
        </div>
      </Card>

      <Card title="Validate & publish">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button onClick={runValidate} style={btn()}>Validate</button>
          <button onClick={() => void publish()} style={allowed && !busy ? btnPrimary('#15803d') : btnDisabled()} disabled={!allowed || busy}>
            {busy ? 'Publishing…' : 'Publish (immutable version)'}
          </button>
        </div>
        {validationMsg && (
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.75rem', fontSize: '0.8rem', color: validationMsg.startsWith('Validation passed') || validationMsg.startsWith('Published') ? '#166534' : '#b91c1c', fontFamily: 'inherit' }}>
            {validationMsg}
          </pre>
        )}
        <AuditNote>Publish is versioned and audited. Once published, the config version is immutable; corrections require a new version.</AuditNote>
      </Card>
    </div>
  );
}

// Preserve the original param type (number/boolean/string) when editing.
function parseParam(original: string | number | boolean, next: string): string | number | boolean {
  if (typeof original === 'number') { const n = Number(next); return Number.isFinite(n) ? n : original; }
  if (typeof original === 'boolean') return next === 'true';
  return next;
}
