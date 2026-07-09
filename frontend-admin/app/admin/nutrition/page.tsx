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

const card = { border: '1px solid #2a2a2a', padding: 12, borderRadius: 6 } as const;
const th = { padding: '8px 6px', fontWeight: 600, opacity: 0.8 } as const;
const td = { padding: '8px 6px' } as const;
const input = { background: '#111', color: '#eee', border: '1px solid #2a2a2a', padding: '4px 6px', borderRadius: 4 } as const;

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
    <div>
      <h1>Nutrition</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Curate the food composition reference, the Nigerian Dish Library, and review dish profiles
        flagged by sanity bounds. Writes are role-gated (RBAC) and audited.
      </p>
      <p style={{ display: 'flex', gap: 12, fontSize: 13 }}>
        <Link href="/admin/nutrition/consults">Consult Review →</Link>
        <Link href="/admin/nutrition/payouts">Nutritionist Payouts →</Link>
      </p>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, borderBottom: '1px solid #2a2a2a', paddingBottom: 8 }}>
        {([
          ['composition', `Composition Reference (${composition.length})`],
          ['library', `Nigerian Dish Library (${library.length})`],
          ['implausible', `Implausible Values (${flaggedCount})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #2a2a2a',
              background: tab === key ? '#1f1f1f' : 'transparent',
              color: '#eee',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Batch re-resolve toolbar */}
      <div style={{ ...card, marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Batch re-resolve</strong>
        <select value={scope} onChange={(e) => setScope(e.target.value as ReresolveScope)} style={input}>
          {SCOPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ fontSize: 12, opacity: 0.7 }}>composition version</label>
        <input type="number" value={reresolveVersion} min={1} onChange={(e) => setReresolveVersion(Number(e.target.value))} style={{ ...input, width: 70 }} />
        <button
          onClick={onBatchReresolve}
          disabled={busy || !canResolve}
          title={!canResolve ? 'Requires nutrition.admin.resolve' : 'Re-resolve (leaves RESTAURANT_CONFIRMED intact)'}
        >
          {busy ? '…' : 'Re-resolve'}
        </button>
        <span style={{ fontSize: 11, opacity: 0.5 }}>RESTAURANT_CONFIRMED profiles are left intact.</span>
      </div>

      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : null}

      {/* ── Composition Reference ── */}
      {!loading && tab === 'composition' ? (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={input}>
              <option value="">All sources</option>
              {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input placeholder="Search code / name…" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
            <button onClick={() => void load()} disabled={loading}>Apply</button>
            <button
              onClick={() => setShowForm((s) => !s)}
              disabled={!canManage}
              title={!canManage ? 'Requires nutrition.admin.manage' : 'Add or version a composition row'}
            >
              {showForm ? 'Cancel' : '+ Add / Version'}
            </button>
          </div>

          {showForm ? (
            <div style={{ ...card, marginTop: 12, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
              <label style={{ fontSize: 12 }}>food_code<input value={form.food_code} onChange={(e) => setForm((f) => ({ ...f, food_code: e.target.value }))} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12, gridColumn: 'span 2' }}>name<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>version<input type="number" value={form.version} min={1} onChange={num('version')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>source
                <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as NutritionSource }))} style={{ ...input, width: '100%' }}>
                  {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>prep_method
                <select value={form.prep_method} onChange={(e) => setForm((f) => ({ ...f, prep_method: e.target.value as PrepMethod }))} style={{ ...input, width: '100%' }}>
                  {PREP_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>energy_kcal<input type="number" value={form.energy_kcal} onChange={num('energy_kcal')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>protein_g<input type="number" value={form.protein_g} onChange={num('protein_g')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>carb_g<input type="number" value={form.carb_g} onChange={num('carb_g')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>sugar_g<input type="number" value={form.sugar_g} onChange={num('sugar_g')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>fat_g<input type="number" value={form.fat_g} onChange={num('fat_g')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>sat_fat_g<input type="number" value={form.sat_fat_g} onChange={num('sat_fat_g')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>fiber_g<input type="number" value={form.fiber_g} onChange={num('fiber_g')} style={{ ...input, width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>sodium_mg<input type="number" value={form.sodium_mg} onChange={num('sodium_mg')} style={{ ...input, width: '100%' }} /></label>
              <div style={{ gridColumn: 'span 4' }}>
                <button onClick={onSaveComposition} disabled={busy || !canManage}>{busy ? 'Saving…' : 'Save (posts new version)'}</button>
                <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>Per-100g figures. Editing posts a new version (additive — old versions retained).</span>
              </div>
            </div>
          ) : null}

          {composition.length === 0 ? (
            <p style={{ opacity: 0.6, marginTop: 16 }}>No composition rows match.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
                  {['food_code', 'name', 'source', 'prep', 'kcal/100g', 'version', 'updated'].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {composition.map((r) => (
                  <tr key={`${r.food_code}@${r.version}`} style={{ borderBottom: '1px solid #1c1c1c' }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.food_code}</td>
                    <td style={td}>{r.name}</td>
                    <td style={td}><SourceBadge source={r.source} /></td>
                    <td style={{ ...td, textTransform: 'capitalize' }}>{r.prep_method}</td>
                    <td style={td}>{r.energy_kcal}</td>
                    <td style={td}>v{r.version}</td>
                    <td style={{ ...td, opacity: 0.6 }}>{ageFromNow(r.updatedAt)}</td>
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
            <p style={{ opacity: 0.6, marginTop: 16 }}>No library dishes.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
                  {['slug', 'name', 'aliases', 'portion (g)', 'kcal/serving', 'components', 'version'].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {library.map((d) => (
                  <tr key={`${d.slug}@${d.version}`} style={{ borderBottom: '1px solid #1c1c1c' }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{d.slug}</td>
                    <td style={td}>{d.name}</td>
                    <td style={{ ...td, opacity: 0.7 }}>{d.aliases.join(', ') || '—'}</td>
                    <td style={td}>{d.standard_portion_g}</td>
                    <td style={td}>{d.per_serving.energy_kcal}</td>
                    <td style={{ ...td, opacity: 0.7 }}>{d.components.length}</td>
                    <td style={td}>v{d.version}</td>
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
            <p style={{ opacity: 0.6, marginTop: 16 }}>No flagged profiles. All resolved values are within sanity bounds.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
                  {['Dish', 'Grounding', 'Confidence', 'Status', 'Review', 'kcal/serving', 'Reason', 'Flagged', ''].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {implausible.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
                    <td style={td}>
                      <Link href={`/admin/nutrition/${p.id}`}><strong>{p.name}</strong></Link>
                      <div style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>{p.dish_id}</div>
                    </td>
                    <td style={td}><GroundingBadge grounding={p.grounding} /></td>
                    <td style={td}><ConfidenceBadge level={p.confidence} /></td>
                    <td style={td}><StatusBadge status={p.status} /></td>
                    <td style={td}><ReviewStateBadge state={p.review_state} /></td>
                    <td style={td}>{p.per_serving.energy_kcal}</td>
                    <td style={{ ...td, maxWidth: 280, fontSize: 12, opacity: 0.8 }}>{p.reason.split('\n')[0]}</td>
                    <td style={{ ...td, opacity: 0.6 }}>{ageFromNow(p.flaggedAt)}</td>
                    <td style={td}><Link href={`/admin/nutrition/${p.id}`}>Review →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  );
}
