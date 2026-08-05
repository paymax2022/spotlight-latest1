'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { ImplausibleProfile } from '@/types/nutritionAdmin';
import {
  getImplausible,
  resolveDish,
  markReviewed,
  ageFromNow,
} from '@/services/nutritionAdminService';
import { GroundingBadge, ConfidenceBadge, StatusBadge, ReviewStateBadge } from '../statusBadge';
import { useNutritionPermissions, NUTRITION_PERMS } from '../_ui';
import { Page, Card, Button, colors, tint, tdCell } from '@/components/ui/vuexy';

export default function NutritionProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useNutritionPermissions();
  const canResolve = can(NUTRITION_PERMS.resolve);
  const canManage = can(NUTRITION_PERMS.manage);

  const [profile, setProfile] = useState<ImplausibleProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setProfile(await getImplausible(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runAction = async (fn: () => Promise<ImplausibleProfile>, label: string) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const updated = await fn();
      setProfile(updated);
      setMessage(`${label} succeeded.`);
    } catch (e) {
      setError(`${label} failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onResolve = () => {
    if (!profile) return;
    if (!confirm(`Force re-resolve "${profile.name}" against the latest composition?`)) return;
    void runAction(() => resolveDish(profile.dish_id), 'Re-resolve');
  };
  const onMarkReviewed = () => {
    if (!profile) return;
    void runAction(() => markReviewed(profile.id, profile.dish_id), 'Mark reviewed');
  };

  if (loading) return <Page><p>Loading profile…</p></Page>;
  if (!profile) return <Page><p style={{ color: colors.danger }}>{error || 'Profile not found.'}</p></Page>;

  const p = profile;

  return (
    <Page>
      <p><Link href="/admin/nutrition">← Back to Nutrition console</Link></p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{p.name}</h1>
        <StatusBadge status={p.status} />
        <ReviewStateBadge state={p.review_state} />
        <GroundingBadge grounding={p.grounding} />
        <ConfidenceBadge level={p.confidence} />
      </div>
      <p style={{ fontSize: 13, color: colors.muted }}>
        dish {p.dish_id} · composition v{p.composition_version} · flagged {ageFromNow(p.flaggedAt)} ago
        {p.reviewedAt ? ` · reviewed ${ageFromNow(p.reviewedAt)} ago` : ''}
      </p>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 12 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Sanity-bound reason */}
          <Card style={{ background: tint(colors.danger, 0.06), borderColor: colors.danger }}>
            <h2 style={{ marginTop: 0 }}>⚠ Sanity-bound failure</h2>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: colors.danger }}>{p.reason}</p>
          </Card>

          {/* Resolved values */}
          <Card>
            <h2 style={{ marginTop: 0 }}>Resolved per-serving values</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {([
                  ['Standard portion', `${p.standard_portion_g} g`],
                  ['Energy', `${p.per_serving.energy_kcal} kcal`],
                  ['Protein', `${p.per_serving.protein_g} g`],
                  ['Carbohydrate', `${p.per_serving.carb_g} g`],
                  ['Fat', `${p.per_serving.fat_g} g`],
                  ['Energy density', `${(p.standard_portion_g ? (p.per_serving.energy_kcal / p.standard_portion_g) * 100 : 0).toFixed(0)} kcal/100g`],
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...tdCell, color: colors.muted, width: '45%' }}>{k}</td>
                    <td style={tdCell}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Actions */}
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <h2 style={{ marginTop: 0 }}>Actions</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <Button
                variant="outline"
                onClick={onResolve}
                disabled={busy || !canResolve}
                title={!canResolve ? 'Requires nutrition.admin.resolve' : 'Force re-resolve this dish against latest composition'}
              >
                {busy ? '…' : 'Re-resolve'}
              </Button>
              <Button
                variant="outline"
                onClick={onMarkReviewed}
                disabled={busy || !canManage}
                title={!canManage ? 'Requires nutrition.admin.manage' : 'Accept the flagged value as-is'}
              >
                {busy ? '…' : 'Mark reviewed'}
              </Button>
              <p style={{ fontSize: 11, color: colors.muted, margin: 0 }}>
                Re-resolve recomputes the profile from the dish components against the latest
                composition version. Mark reviewed accepts the current value and clears the flag.
              </p>
            </div>
          </Card>

          <Card>
            <h2 style={{ marginTop: 0 }}>Profile state</h2>
            <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0, display: 'grid', gap: 4 }}>
              <li>Status: {p.status.replace(/_/g, ' ')}</li>
              <li>Review: {p.review_state}</li>
              <li>Grounding: {p.grounding}</li>
              <li>Confidence: {p.confidence}</li>
              <li>Composition version: v{p.composition_version}</li>
              <li>Flagged: {new Date(p.flaggedAt).toLocaleString()}</li>
              {p.reviewedAt ? <li>Reviewed: {new Date(p.reviewedAt).toLocaleString()}</li> : null}
              <li style={{ fontSize: 12, color: colors.muted }}>Dish ID: {p.dish_id}</li>
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
