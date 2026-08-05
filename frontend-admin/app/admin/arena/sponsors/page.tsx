'use client';

// A8 — Sponsor / Featured Placement manager (SCAFFOLD, service wired). RBAC:
// arena.admin.manage (Competition Admin). Onboard sponsors, configure branded
// challenges/badges + placement slots (home, driver profiles, finale overlays),
// schedule, monitor delivery/impressions. Reuses paid-promotion mechanics.
//
// NDC-1: the Sponsor rail can NEVER bind to Merit awards — sponsors weight
// engagement rewards only, walled off from the crown. Onboarding + scheduling
// forms are a later build; the slot listing is wired to the backend contract.

import { useCallback, useEffect, useState } from 'react';
import { listCompetitions, listSponsorSlots } from '@/services/arenaAdminService';
import type { Competition, SponsorSlot } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, timeAgo, LockedChip, ScaffoldNotice, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

export default function ArenaSponsorsPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.admin);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [rows, setRows] = useState<SponsorSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null);
    try { setRows(await listSponsorSlots(competitionId)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Page>
      <PageHeader
        title="Arena — Sponsor / Featured Placement (A8)"
        subtitle="Sponsor slots, branded placements, delivery/impressions. Reuses paid-promotion. RBAC: arena.admin.manage."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      <ScaffoldNotice>Sponsor onboarding, challenge/badge config, and slot scheduling forms are not built yet. Slot listing + delivery monitoring are wired to the backend contract.</ScaffoldNotice>

      <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.info, marginBottom: '1.25rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <LockedChip label="NDC-1" /> The Sponsor rail weights engagement rewards only. It can never bind to a Merit award — sponsors cannot influence the crown.
      </div>

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Placement slots">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading sponsor slots…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No sponsor slots configured.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Sponsor</th>
                  <th style={thCell}>Placement</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Window</th>
                  <th style={thCell}>Impressions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td style={tdCell}>{s.sponsor}</td>
                    <td style={tdCell}><Badge text={s.placement.replace(/_/g, ' ')} color={colors.secondary} /></td>
                    <td style={tdCell}>
                      <Badge text={s.status} color={s.status === 'live' ? colors.success : s.status === 'scheduled' ? colors.warning : colors.secondary} />
                    </td>
                    <td style={{ ...tdCell, fontSize: '0.8rem' }}>{timeAgo(s.starts_at)} → {timeAgo(s.ends_at)}</td>
                    <td style={{ ...tdCell, ...mono() }}>{s.impressions != null ? s.impressions.toLocaleString('en-NG') : '—'}</td>
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
