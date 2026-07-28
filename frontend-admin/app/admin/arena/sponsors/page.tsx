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
import {
  PageHeader, Card, btn, th, td, selectStyle, mono,
  timeAgo, Pill, LockedChip, ScaffoldNotice, PermissionBanner, ARENA_PERMS, useArenaPermission,
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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Sponsor / Featured Placement (A8)"
        subtitle="Sponsor slots, branded placements, delivery/impressions. Reuses paid-promotion. RBAC: arena.admin.manage."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
          </div>
        }
      />

      <ScaffoldNotice>Sponsor onboarding, challenge/badge config, and slot scheduling forms are not built yet. Slot listing + delivery monitoring are wired to the backend contract.</ScaffoldNotice>

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#1e40af', marginBottom: '1.25rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <LockedChip label="NDC-1" /> The Sponsor rail weights engagement rewards only. It can never bind to a Merit award — sponsors cannot influence the crown.
      </div>

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card title="Placement slots">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading sponsor slots…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No sponsor slots configured.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Sponsor</th>
                  <th style={th()}>Placement</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Window</th>
                  <th style={th()}>Impressions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td style={td()}>{s.sponsor}</td>
                    <td style={td()}><Pill fg="#374151" bg="#f3f4f6">{s.placement.replace(/_/g, ' ')}</Pill></td>
                    <td style={td()}>
                      <Pill fg={s.status === 'live' ? '#15803d' : s.status === 'scheduled' ? '#9a3412' : '#6b7280'} bg={s.status === 'live' ? '#dcfce7' : s.status === 'scheduled' ? '#ffedd5' : '#f3f4f6'}>{s.status}</Pill>
                    </td>
                    <td style={{ ...td(), fontSize: '0.8rem' }}>{timeAgo(s.starts_at)} → {timeAgo(s.ends_at)}</td>
                    <td style={{ ...td(), ...mono() }}>{s.impressions != null ? s.impressions.toLocaleString('en-NG') : '—'}</td>
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
