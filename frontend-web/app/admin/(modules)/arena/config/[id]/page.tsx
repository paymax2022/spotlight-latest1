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
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, CompetitionStatusBadge, LockedChip, AuditNote, PermissionBanner, BackToArena,
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

  if (loading) return <Page><BackToArena /><p style={{ color: colors.muted, marginTop: '1rem' }}>Loading config…</p></Page>;
  if (error && !config) return <Page><BackToArena /><p style={{ color: colors.danger, marginTop: '1rem' }}>{error}</p></Page>;
  if (!config) return null;

  const railParamsFor = (kind: RailKind) => paramEntries.find(([k]) => k === kind)?.[1] ?? [];

  return (
    <Page>
      <div style={{ marginBottom: '0.75rem' }}><BackToArena /></div>
      <PageHeader
        title={competition ? competition.name : 'Competition config'}
        subtitle={`Slug: ${competition?.slug ?? id}. Configure rails + bindings, validate, publish. RBAC: arena.admin.manage.`}
        actions={competition ? <CompetitionStatusBadge status={competition.status} /> : undefined}
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {config.published && (
        <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>
          Published config version <strong>{config.config_version}</strong> is immutable. Publishing again creates a new version.
        </div>
      )}

      <Card title="Rails" style={{ marginBottom: 20 }}>
        <p style={{ color: colors.muted, fontSize: '0.8rem', marginTop: 8 }}>
          Four first-class channels. Merit is the only rail that may feed the crown — money (Support) and engagement (Play-Along/Sponsor) are firewalled from it.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Rail</th>
                <th style={thCell}>Enabled</th>
                <th style={thCell}>Parameters</th>
              </tr>
            </thead>
            <tbody>
              {config.rails.map((r) => (
                <tr key={r.kind}>
                  <td style={tdCell}><strong>{RAIL_LABELS[r.kind]}</strong></td>
                  <td style={tdCell}>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      disabled={!allowed}
                      onChange={(e) => setRail(r.kind, { enabled: e.target.checked })}
                    />
                  </td>
                  <td style={tdCell}>
                    {railParamsFor(r.kind).length === 0 ? (
                      <span style={{ color: colors.muted }}>No params</span>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {railParamsFor(r.kind).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ ...mono(), color: colors.muted, minWidth: 160 }}>{k}</span>
                            <Input
                              value={String(v)}
                              disabled={!allowed}
                              onChange={(e) => setRail(r.kind, { params: { ...r.params, [k]: parseParam(v, e.target.value) } })}
                              style={{ minWidth: 200 }}
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

      <Card title="Award → rail bindings" style={{ marginBottom: 20 }}>
        <p style={{ color: colors.muted, fontSize: '0.8rem', marginTop: 8 }}>
          Each award draws from exactly one rail. The <strong>crown is bound to Merit and LOCKED</strong> (NDC-1) — it can never be made to accept money or engagement.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Award</th>
                <th style={thCell}>Bound rail</th>
                <th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {config.award_bindings.map((b: AwardBinding) => {
                const railOptions = ALLOWED_RAILS[b.award] ?? (['MERIT', 'SUPPORT', 'PLAY_ALONG', 'SPONSOR'] as RailKind[]);
                const isCrown = b.award === 'NAIJA_DRIVER_CROWN';
                const locked = isCrown || b.locked;
                return (
                  <tr key={b.award}>
                    <td style={tdCell}><strong>{AWARD_LABELS[b.award]}</strong></td>
                    <td style={tdCell}>
                      {locked ? (
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          {RAIL_LABELS[b.rail]}
                        </span>
                      ) : (
                        <select
                          value={b.rail}
                          disabled={!allowed}
                          onChange={(e) => setBinding(b.award, e.target.value as RailKind)}
                        >
                          {railOptions.map((rk) => (
                            <option key={rk} value={rk}>{RAIL_LABELS[rk]}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={tdCell}>{locked ? <LockedChip label={isCrown ? 'NDC-1 · Merit-only' : 'LOCKED'} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Schema & rubric versions" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 8 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Screening schema version
            <Input value={config.screening_schema_version} disabled={!allowed} onChange={(e) => setConfig({ ...config, screening_schema_version: e.target.value })} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Rubric version (Merit)
            <Input value={config.rubric_version} disabled={!allowed} onChange={(e) => setConfig({ ...config, rubric_version: e.target.value })} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: colors.muted }}>
            Exam schema version (theory)
            <Input value={config.exam_schema_version} disabled={!allowed} onChange={(e) => setConfig({ ...config, exam_schema_version: e.target.value })} />
          </label>
        </div>
      </Card>

      <Card title="Validate & publish">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: 8 }}>
          <Button variant="outline" onClick={runValidate}>Validate</Button>
          <Button variant="primary" onClick={() => void publish()} disabled={!allowed || busy}>
            {busy ? 'Publishing…' : 'Publish (immutable version)'}
          </Button>
        </div>
        {validationMsg && (
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.75rem', fontSize: '0.8rem', color: validationMsg.startsWith('Validation passed') || validationMsg.startsWith('Published') ? colors.success : colors.danger, fontFamily: 'inherit' }}>
            {validationMsg}
          </pre>
        )}
        <AuditNote>Publish is versioned and audited. Once published, the config version is immutable; corrections require a new version.</AuditNote>
      </Card>
    </Page>
  );
}

// Preserve the original param type (number/boolean/string) when editing.
function parseParam(original: string | number | boolean, next: string): string | number | boolean {
  if (typeof original === 'number') { const n = Number(next); return Number.isFinite(n) ? n : original; }
  if (typeof original === 'boolean') return next === 'true';
  return next;
}
