'use client';

// AK7 — Thresholds & tier policy (SCAFFOLD).
// RBAC: finance.admin.kyc (role: Compliance). Facial-match threshold, which
// checks each CBN tier requires, EDD rules. This reads the routing rules'
// thresholds read-only; per-tier required-check matrix + EDD rules are TBD.

import { useCallback, useEffect, useState } from 'react';
import { listRoutingRules } from '@/services/kycAdminService';
import type { KycRoutingRule } from '@/types/kycAdmin';
import { CHECK_TYPE_LABELS, TIER_LABELS } from '@/types/kycAdmin';
import { PageHeader, Card, btn, th, td, ScaffoldNotice } from '../_ui';

// Placeholder per-tier required-check matrix (until backend policy endpoint exists).
const TIER_REQUIRED: Record<number, string[]> = {
  1: ['ID_NUMBER'],
  2: ['ID_NUMBER', 'ID_FACIAL', 'LIVENESS'],
  3: ['ID_NUMBER', 'ID_FACIAL', 'LIVENESS', 'DOCUMENT', 'AML'],
};

export default function KycThresholdsPage() {
  const [rules, setRules] = useState<KycRoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRules(await listRoutingRules()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Thresholds & Tier Policy (AK7)"
        subtitle="Facial-match threshold, required checks per CBN tier, EDD rules. RBAC: finance.admin.kyc (Compliance)."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />

      <ScaffoldNotice>
        Functional shell. Thresholds shown read-only from routing rules; the per-tier required-check matrix below is a placeholder pending a policy endpoint. Editing lives in AK6 (Routing rules) for now.
      </ScaffoldNotice>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card title="Per-check thresholds (from routing rules)">
        {loading ? (
          <p style={{ color: '#6b7280', margin: 0 }}>Loading…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th()}>Check</th><th style={th()}>Threshold</th><th style={th()}>Enabled</th></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.check_type}>
                  <td style={td()}>{CHECK_TYPE_LABELS[r.check_type]}</td>
                  <td style={td()}>{r.threshold}%</td>
                  <td style={td()}>{r.enabled ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Required checks per tier (placeholder)">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={th()}>Tier</th><th style={th()}>Required checks</th></tr>
          </thead>
          <tbody>
            {Object.entries(TIER_REQUIRED).map(([tier, checks]) => (
              <tr key={tier}>
                <td style={td()}>{TIER_LABELS[Number(tier)] ?? `Tier ${tier}`}</td>
                <td style={td()}>{checks.map((c) => CHECK_TYPE_LABELS[c as keyof typeof CHECK_TYPE_LABELS]).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
