'use client';

import { useEffect, useState } from 'react';
import { listTiers, updateTier, formatPoints } from '@/services/loyaltyAdminService';
import type { TierConfig } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Badge, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, th, td, fmtDate } from '../../events/_ui';

export default function TiersPage() {
  const [rows, setRows] = useState<TierConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listTiers()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function editThreshold(t: TierConfig) {
    const v = window.prompt(`New lifetime-points threshold for "${t.name}" (current ${t.threshold_points}). Members re-evaluate on next earn. Versioned config:`, String(t.threshold_points));
    if (v === null) return;
    const thr = Number(v);
    if (Number.isNaN(thr) || thr < 0) { setMsg('Invalid threshold.'); return; }
    setBusy(t.id); setMsg(null);
    try {
      const res = await updateTier(t.id, { threshold_points: thr });
      setMsg(res.message + ` (now v${res.config_version}, audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function editMultiplier(t: TierConfig) {
    const v = window.prompt(`New earn multiplier for "${t.name}" (current ${t.earn_multiplier}). Versioned config:`, String(t.earn_multiplier));
    if (v === null) return;
    const m = Number(v);
    if (Number.isNaN(m) || m <= 0) { setMsg('Invalid multiplier.'); return; }
    setBusy(t.id); setMsg(null);
    try {
      const res = await updateTier(t.id, { earn_multiplier: m });
      setMsg(res.message + ` (now v${res.config_version}, audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Tier configuration" subtitle="Tier thresholds, earn multipliers and benefits. Membership ladder TIER1 → TIER2 → TIER3 (Black added Phase 3)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LoyaltyTabs active="tiers" />
      <DisclosureNote>Thresholds are in lifetime <strong>points</strong> (non-cash, NL-4). Changing a threshold or multiplier creates a new versioned config and re-evaluates members on their next earn. Every change is audited (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No tiers configured.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Tier</th><th style={th()}>Threshold</th><th style={th()}>Members</th><th style={th()}>Earn ×</th>
              <th style={th()}>Benefits</th><th style={th()}>Status</th><th style={th()}>Config v</th><th style={th()}>Updated</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td style={td()}>{t.name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>rank {t.rank} · {t.id}</div></td>
                  <td style={td()}>{formatPoints(t.threshold_points)}</td>
                  <td style={td()}>{t.members.toLocaleString('en-NG')}</td>
                  <td style={td()}>{t.earn_multiplier.toFixed(2)}×</td>
                  <td style={td()}>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                      {t.benefits.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  </td>
                  <td style={td()}><Badge status={t.status} /></td>
                  <td style={td()}>v{t.config_version}</td>
                  <td style={td()}>{fmtDate(t.updated_at)}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button style={btnPrimary()} disabled={busy === t.id} onClick={() => editThreshold(t)}>{busy === t.id ? '…' : 'Threshold'}</button>
                      <button style={btn()} disabled={busy === t.id} onClick={() => editMultiplier(t)}>Multiplier</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
