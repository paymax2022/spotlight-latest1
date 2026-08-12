'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type {
  CompositionReference,
  DishLibraryEntry,
  ImplausibleProfile,
  NutritionSource,
  PrepMethod,
  ReresolveScope,
} from '@/types/nutritionAdmin';
import {
  listComposition,
  listLibrary,
  listImplausible,
  upsertComposition,
  reresolve,
  ageFromNow,
} from '@/services/nutritionAdminService';
import { SourceBadge, GroundingBadge, ConfidenceBadge, StatusBadge, ReviewStateBadge } from './statusBadge';
import { useNutritionPermissions, NUTRITION_PERMS } from './_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SOURCE_OPTIONS: NutritionSource[] = ['WAFCT', 'NFCT', 'OFF', 'FALLBACK', 'CUSTOM'];
const PREP_OPTIONS: PrepMethod[] = ['raw', 'boiled', 'fried', 'grilled', 'roasted', 'steamed', 'stewed', 'baked'];
const SCOPE_OPTIONS: ReresolveScope[] = ['all', 'library', 'ai'];

type Tab = 'composition' | 'library' | 'implausible';

const emptyComposition: Omit<CompositionReference, 'updatedAt'> = {
  food_code: '',
  name: '',
  source: 'CUSTOM',
  prep_method: 'stewed',
  energy_kcal: 0,
  protein_g: 0,
  carb_g: 0,
  sugar_g: 0,
  fat_g: 0,
  sat_fat_g: 0,
  fiber_g: 0,
  sodium_mg: 0,
  version: 1,
};

export default function NutritionConsolePage() {
  const { can } = useNutritionPermissions();
  const canManage = can(NUTRITION_PERMS.manage);
  const canResolve = can(NUTRITION_PERMS.resolve);

  const [tab, setTab] = useState<Tab>('composition');
  const [composition, setComposition] = useState<CompositionReference[]>([]);
  const [library, setLibrary] = useState<DishLibraryEntry[]>([]);
  const [implausible, setImplausible] = useState<ImplausibleProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // composition filters
  const [sourceFilter, setSourceFilter] = useState('');
  const [q, setQ] = useState('');

  // add/version form
  const [form, setForm] = useState(emptyComposition);
  const [showForm, setShowForm] = useState(false);

  // batch re-resolve
  const [scope, setScope] = useState<ReresolveScope>('all');
  const [reresolveVersion, setReresolveVersion] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [c, l, i] = await Promise.all([
        listComposition({ source: sourceFilter, q }),
        listLibrary(),
        listImplausible(),
      ]);
      setComposition(c);
      setLibrary(l);
      setImplausible(i);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveComposition = async () => {
    if (!form.food_code.trim() || !form.name.trim()) {
      setError('food_code and name are required.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await upsertComposition(form);
      setMessage(`Saved composition ${form.food_code} (v${form.version}).`);
      setShowForm(false);
      setForm(emptyComposition);
      await load();
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onBatchReresolve = async () => {
    if (!confirm(`Batch re-resolve scope "${scope}" against composition v${reresolveVersion}? RESTAURANT_CONFIRMED profiles are left intact.`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { requeued } = await reresolve(scope, reresolveVersion);
      setMessage(`Re-resolve queued: ${requeued} profile(s) (scope=${scope}, v${reresolveVersion}).`);
      await load();
    } catch (e) {
      setError(`Re-resolve failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const num = (k: keyof typeof emptyComposition) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: Number(e.target.value) }));

  const flaggedCount = implausible.filter((p) => p.review_state === 'FLAGGED').length;

  return (
    <Page>
      <PageHeader
        title="Nutrition"
        subtitle="Curate the food composition reference, the Nigerian Dish Library, and review dish profiles flagged by sanity bounds. Writes are role-gated (RBAC) and audited."
      />
      <p style={{ display: 'flex', gap: 12, fontSize: 13, marginTop: -8 }}>
        <Link href="/admin/nutrition/consults">Consult Review →</Link>
        <Link href="/admin/nutrition/payouts">Nutritionist Payouts →</Link>
      </p>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, borderBottom: `1px solid ${colors.border}`, paddingBottom: 8 }}>
        {([
          ['composition', `Composition Reference (${composition.length})`],
          ['library', `Nigerian Dish Library (${library.length})`],
          ['implausible', `Implausible Values (${flaggedCount})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <Button key={key} sm variant={tab === key ? 'primary' : 'outline'} onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </div>

      {/* Batch re-resolve toolbar */}
      <Card style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Batch re-resolve</strong>
        <select value={scope} onChange={(e) => setScope(e.target.value as ReresolveScope)}>
          {SCOPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ fontSize: 12, color: colors.muted }}>composition version</label>
        <Input type="number" value={reresolveVersion} min={1} onChange={(e) => setReresolveVersion(Number(e.target.value))} style={{ width: 70 }} />
        <Button
          variant="outline"
          onClick={onBatchReresolve}
          disabled={busy || !canResolve}
          title={!canResolve ? 'Requires nutrition.admin.resolve' : 'Re-resolve (leaves RESTAURANT_CONFIRMED intact)'}
        >
          {busy ? '…' : 'Re-resolve'}
        </Button>
        <span style={{ fontSize: 11, color: colors.muted }}>RESTAURANT_CONFIRMED profiles are left intact.</span>
      </Card>

      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : null}

      {/* ── Composition Reference ── */}
      {!loading && tab === 'composition' ? (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">All sources</option>
              {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Input placeholder="Search code / name…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="outline" onClick={() => void load()} disabled={loading}>Apply</Button>
            <Button
              variant="outline"
              onClick={() => setShowForm((s) => !s)}
              disabled={!canManage}
              title={!canManage ? 'Requires nutrition.admin.manage' : 'Add or version a composition row'}
            >
              {showForm ? 'Cancel' : '+ Add / Version'}
            </Button>
          </div>

          {showForm ? (
            <Card style={{ marginTop: 12, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
              <label style={{ fontSize: 12 }}>food_code<Input value={form.food_code} onChange={(e) => setForm((f) => ({ ...f, food_code: e.target.value }))} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12, gridColumn: 'span 2' }}>name<Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>version<Input type="number" value={form.version} min={1} onChange={num('version')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>source
                <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as NutritionSource }))} style={{ width: '100%' }}>
                  {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>prep_method
                <select value={form.prep_method} onChange={(e) => setForm((f) => ({ ...f, prep_method: e.target.value as PrepMethod }))} style={{ width: '100%' }}>
                  {PREP_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>energy_kcal<Input type="number" value={form.energy_kcal} onChange={num('energy_kcal')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>protein_g<Input type="number" value={form.protein_g} onChange={num('protein_g')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>carb_g<Input type="number" value={form.carb_g} onChange={num('carb_g')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>sugar_g<Input type="number" value={form.sugar_g} onChange={num('sugar_g')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>fat_g<Input type="number" value={form.fat_g} onChange={num('fat_g')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>sat_fat_g<Input type="number" value={form.sat_fat_g} onChange={num('sat_fat_g')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>fiber_g<Input type="number" value={form.fiber_g} onChange={num('fiber_g')} style={{ width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>sodium_mg<Input type="number" value={form.sodium_mg} onChange={num('sodium_mg')} style={{ width: '100%' }} /></label>
              <div style={{ gridColumn: 'span 4' }}>
                <Button variant="primary" onClick={onSaveComposition} disabled={busy || !canManage}>{busy ? 'Saving…' : 'Save (posts new version)'}</Button>
                <span style={{ fontSize: 11, color: colors.muted, marginLeft: 8 }}>Per-100g figures. Editing posts a new version (additive — old versions retained).</span>
              </div>
            </Card>
          ) : null}

          {composition.length === 0 ? (
            <p style={{ color: colors.muted, marginTop: 16 }}>No composition rows match.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
              <thead>
                <tr>
                  {['food_code', 'name', 'source', 'prep', 'kcal/100g', 'version', 'updated'].map((h) => <th key={h} style={thCell}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {composition.map((r) => (
                  <tr key={`${r.food_code}@${r.version}`}>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.food_code}</td>
                    <td style={tdCell}>{r.name}</td>
                    <td style={tdCell}><SourceBadge source={r.source} /></td>
                    <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.prep_method}</td>
                    <td style={tdCell}>{r.energy_kcal}</td>
                    <td style={tdCell}>v{r.version}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>{ageFromNow(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {/* ── Nigerian Dish Library ── */}
      {!loading && tab === 'library' ? (
        <section style={{ marginTop: 16 }}>
          {library.length === 0 ? (
            <p style={{ color: colors.muted, marginTop: 16 }}>No library dishes.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['slug', 'name', 'aliases', 'portion (g)', 'kcal/serving', 'components', 'version'].map((h) => <th key={h} style={thCell}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {library.map((d) => (
                  <tr key={`${d.slug}@${d.version}`}>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{d.slug}</td>
                    <td style={tdCell}>{d.name}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>{d.aliases.join(', ') || '—'}</td>
                    <td style={tdCell}>{d.standard_portion_g}</td>
                    <td style={tdCell}>{d.per_serving.energy_kcal}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>{d.components.length}</td>
                    <td style={tdCell}>v{d.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {/* ── Implausible Values review queue ── */}
      {!loading && tab === 'implausible' ? (
        <section style={{ marginTop: 16 }}>
          {implausible.length === 0 ? (
            <p style={{ color: colors.muted, marginTop: 16 }}>No flagged profiles. All resolved values are within sanity bounds.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Dish', 'Grounding', 'Confidence', 'Status', 'Review', 'kcal/serving', 'Reason', 'Flagged', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {implausible.map((p) => (
                  <tr key={p.id}>
                    <td style={tdCell}>
                      <Link href={`/admin/nutrition/${p.id}`}><strong>{p.name}</strong></Link>
                      <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>{p.dish_id}</div>
                    </td>
                    <td style={tdCell}><GroundingBadge grounding={p.grounding} /></td>
                    <td style={tdCell}><ConfidenceBadge level={p.confidence} /></td>
                    <td style={tdCell}><StatusBadge status={p.status} /></td>
                    <td style={tdCell}><ReviewStateBadge state={p.review_state} /></td>
                    <td style={tdCell}>{p.per_serving.energy_kcal}</td>
                    <td style={{ ...tdCell, maxWidth: 280, fontSize: 12, color: colors.muted }}>{p.reason.split('\n')[0]}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>{ageFromNow(p.flaggedAt)}</td>
                    <td style={tdCell}><Link href={`/admin/nutrition/${p.id}`}>Review →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </Page>
  );
}
