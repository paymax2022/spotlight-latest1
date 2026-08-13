'use client';

// SU-01 — Platform School Directory. Every school on the platform at a glance:
// verification tier, status, GMV, trust score. RBAC: platform_edtech_admin.

import { useEffect, useMemo, useState } from 'react';
import { listPlatformSchools } from '@/services/platformEdtechAdminService';
import type { PlatformSchool } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, formatNaira, fmtDate,
  PageHeader, Kpi, Card, Badge, StateBlock, DisclosureNote, Bar, th, td, input, select,
} from './_ui';
import { colors } from '@/components/ui/vuexy';

export default function PlatformDirectoryPage() {
  const [schools, setSchools] = useState<PlatformSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setSchools(await listPlatformSchools()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => schools.filter((s) =>
    (!q || s.name.toLowerCase().includes(q.toLowerCase()) || s.state.toLowerCase().includes(q.toLowerCase())) &&
    (!tier || s.verification_tier === tier) &&
    (!status || s.status === status)), [schools, q, tier, status]);

  const gmv = schools.reduce((s, x) => s + x.gmv_kobo, 0);
  const maxGmv = Math.max(1, ...schools.map((s) => s.gmv_kobo));

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Platform School Directory" subtitle="Every school on the Paymax EdTech platform — verification tier, operating status, lifetime collections and trust score." action={<button onClick={load} style={{ padding: '0.35rem 0.8rem' }}>Refresh</button>} />
        <PlatformTabs active="directory" />
        <DisclosureNote>Platform-operator surface. Requires <code>platform_edtech_admin</code> — a school owner/bursar has zero visibility (Checkpoint E). Read-only directory; verification changes happen in the Verification queue (SU-02).</DisclosureNote>

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Schools" value={schools.length.toString()} sub={`${schools.filter((s) => s.status === 'active').length} active`} accent={colors.primary} />
            <Kpi label="Verified+ tier" value={schools.filter((s) => s.verification_tier === 'verified' || s.verification_tier === 'premium').length.toString()} />
            <Kpi label="Platform GMV" value={formatNaira(gmv)} accent={colors.success} />
            <Kpi label="Students reached" value={schools.reduce((s, x) => s + x.students, 0).toLocaleString('en-NG')} />
          </div>

          <Card title="Directory">
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <input style={{ ...input(), maxWidth: 260 }} placeholder="Search name or state…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select style={{ ...select(), maxWidth: 180 }} value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">All tiers</option><option value="unverified">Unverified</option><option value="basic">Basic</option><option value="verified">Verified</option><option value="premium">Premium</option>
              </select>
              <select style={{ ...select(), maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option>
              </select>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>School</th><th style={th()}>State</th><th style={th()}>Tier</th><th style={th()}>Status</th><th style={th()}>Students</th><th style={th()}>GMV</th><th style={th()}>Trust</th><th style={th()}>Gov sync</th><th style={th()}>Onboarded</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td style={td()}><strong>{s.name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{s.id}</div></td>
                    <td style={td()}>{s.state}</td>
                    <td style={td()}><Badge status={s.verification_tier} /></td>
                    <td style={td()}><Badge status={s.status} /></td>
                    <td style={td()}>{s.students.toLocaleString('en-NG')}</td>
                    <td style={td()}><div style={{ minWidth: 140 }}><Bar value={s.gmv_kobo} max={maxGmv} labelRight={formatNaira(s.gmv_kobo)} /></div></td>
                    <td style={td()}><strong style={{ color: s.trust_score >= 75 ? colors.success : s.trust_score >= 50 ? colors.warning : colors.danger }}>{s.trust_score}</strong></td>
                    <td style={td()}>{s.gov_sync_opt_in ? <Badge status="active" label="opted in" /> : <Badge status="none" label="off" />}</td>
                    <td style={td()}>{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No schools match the filters.</p> : null}
          </Card>
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
