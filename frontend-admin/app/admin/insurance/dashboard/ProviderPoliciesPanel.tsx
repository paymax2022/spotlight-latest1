'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getProviderPolicies,
  syncProviderPolicies,
  formatNaira,
  InsuranceAdminError,
  type ProviderPoliciesReport,
} from '@/services/insuranceAdminService';
import { Card, Badge, btn, btnPrimary, th, td, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

/**
 * What the PROVIDER (MyCover) holds for our account, beside Paymax's own book.
 *
 * The KPI tiles above count only policies bought through the Paymax app. A policy
 * bought directly at MyCover is invisible to them, which read as "your purchases
 * did not reflect". This panel shows those policies, clearly separated: the
 * premium here is NOT revenue and is never added to the figures above, because
 * it never moved through our ledger.
 */
export default function ProviderPoliciesPanel() {
  const [report, setReport] = useState<ProviderPoliciesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await getProviderPolicies());
      setError(null);
    } catch (e) {
      if (e instanceof InsuranceAdminError && e.status === 404) setDisabled(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const r = await syncProviderPolicies();
      setNotice(`Synced from ${r.provider}: ${r.fetched} policies (${r.inserted} new, ${r.updated} refreshed).`);
      await load();
    } catch (e) {
      if (e instanceof InsuranceAdminError && e.status === 503) setError('The MyCover API key is not configured on this server.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  if (disabled) {
    return (
      <Card title="Policies held at the provider">
        <p style={{ margin: 0, color: colors.muted, fontSize: '0.85rem' }}>
          Not enabled on this server. Set <code>FEATURE_INSURANCE_PROVIDER_IMPORT_ENABLED=true</code> on the
          backend to see policies bought directly at MyCover.
        </p>
      </Card>
    );
  }

  const ov = report?.overview;

  return (
    <Card
      title="Policies held at the provider (MyCover)"
      right={<button type="button" style={syncing ? { ...btn(), opacity: 0.6 } : btnPrimary()} onClick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>}
    >
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: colors.muted, lineHeight: 1.5 }}>
        The figures above count only policies bought through the Paymax app. This list is what MyCover holds
        for our account, so purchases made directly there show up here. Their premium is <strong>not</strong> Paymax
        revenue and is not included above.
      </p>

      {loading && !report ? <p style={{ color: colors.muted }}>Loading…</p> : null}
      {error ? <p role="alert" style={{ color: colors.danger, margin: '0 0 0.75rem' }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: '0 0 0.75rem', fontSize: '0.85rem' }}>{notice}</p> : null}

      {ov ? (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
          <strong>{ov.total}</strong> at the provider · <strong>{ov.in_paymax}</strong> also in Paymax&apos;s book ·{' '}
          <strong>{ov.not_in_paymax}</strong> not in Paymax ({formatNaira(ov.not_in_paymax_premium_kobo)} premium).{' '}
          <span style={{ color: colors.muted }}>
            {ov.last_synced_at ? `Last synced ${new Date(ov.last_synced_at).toLocaleString('en-NG')}.` : 'Never synced. Press Sync now.'}
          </span>
        </p>
      ) : null}

      {report && report.policies.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Product', 'Policy no.', 'Status', 'Premium', 'Starts', 'Expires', 'Bought', 'In Paymax'].map((h) => (
                  <th key={h} style={th()}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.policies.map((p) => (
                <tr key={p.provider_policy_ref}>
                  <td style={td()}>{p.product_name || '—'}</td>
                  <td style={{ ...td(), fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.policy_number || '—'}</td>
                  <td style={td()}>{p.status ? <Badge status={p.status} /> : '—'}</td>
                  <td style={td()}>{formatNaira(p.premium_kobo)}</td>
                  <td style={td()}>{fmtDate(p.starts_at)}</td>
                  <td style={td()}>{fmtDate(p.expires_at)}</td>
                  <td style={td()}>{fmtDate(p.provider_created_at)}</td>
                  <td style={td()}>{p.in_paymax ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {report && report.policies.length === 0 && !loading ? (
        <p style={{ margin: 0, color: colors.muted, fontSize: '0.85rem' }}>
          Nothing mirrored yet. Press <strong>Sync now</strong> to pull the list from MyCover.
        </p>
      ) : null}
    </Card>
  );
}
