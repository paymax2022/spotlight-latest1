'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCategories, setCategoryActive } from '@/services/marketplaceAdminService';
import type { MktCategory } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, StateBlock, AuditNote, FilterBar,
  PermissionBanner, btn, btnPrimary, btnDanger, btnDisabled, th, td, input, select, label as lbl, timeAgo,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

// Taxonomy console (TS-2 CAT-001…008, EC-007). Category tree + per-category
// attribute schema. The attribute_schema authored here is what the backend
// enforces on every listing write (internal/marketplace/attrs_validation.go).
export default function TaxonomyPage() {
  const { allowed: canManage } = useMarketplacePermission(MARKETPLACE_PERMS.taxonomy);
  const [rows, setRows] = useState<MktCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<string>('');
  const [showInactive, setShowInactive] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listCategories()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const nameById = useMemo(() => Object.fromEntries(rows.map((c) => [c.id, c.name])), [rows]);

  const filtered = useMemo(() => rows.filter((c) => {
    if (!showInactive && !c.is_active) return false;
    if (tier !== '' && c.risk_tier !== Number(tier)) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      if (!c.name.toLowerCase().includes(needle) && !c.slug.toLowerCase().includes(needle)) return false;
    }
    return true;
  }), [rows, showInactive, tier, q]);

  // Roots first, each followed by its children (single-level nesting display).
  const ordered = useMemo(() => {
    const roots = filtered.filter((c) => !c.parent_id);
    const out: MktCategory[] = [];
    for (const r of roots) {
      out.push(r);
      out.push(...filtered.filter((c) => c.parent_id === r.id));
    }
    // orphaned children whose parent was filtered out
    out.push(...filtered.filter((c) => c.parent_id && !roots.some((r) => r.id === c.parent_id)));
    return out;
  }, [filtered]);

  async function toggleActive(c: MktCategory) {
    const reason = (reasonDraft[c.id] ?? '').trim();
    if (!reason) { setError(`reason_code is required to ${c.is_active ? 'disable' : 'enable'} “${c.name}”.`); return; }
    setBusyId(c.id); setMsg(null); setError(null);
    try {
      await setCategoryActive(c.id, !c.is_active, reason);
      setMsg(`Category “${c.name}” → ${c.is_active ? 'disabled' : 'enabled'} (${reason}). Audit entry recorded.`);
      setReasonDraft((s) => ({ ...s, [c.id]: '' }));
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  const attrCount = (c: MktCategory) => Object.keys(c.attribute_schema?.properties ?? {}).length;
  const reqCount = (c: MktCategory) => (c.attribute_schema?.required ?? []).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Taxonomy"
        subtitle="Category tree, risk tier, commission, and the per-category attribute schema enforced on every listing at write time."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
            <Link href="/admin/marketplace/taxonomy/new" style={{ ...btnPrimary(), textDecoration: 'none' }}>+ New category</Link>
          </div>
        }
      />
      <MarketplaceTabs active="taxonomy" />
      <DisclosureNote>
        The <code>attribute_schema</code> you author here is the contract the backend validates listings against
        (<code>required</code>, per-field <code>type</code>/<code>enum</code>/<code>min</code>/<code>max</code>). Disabling a category
        with active listings is refused (<code>CATEGORY_HAS_LISTINGS</code>, EC-007). Every change writes an audit row.
      </DisclosureNote>

      {!canManage && <PermissionBanner permission={MARKETPLACE_PERMS.taxonomy} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div>
          <label style={lbl()}>Search</label>
          <input style={input()} placeholder="name or slug" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label style={lbl()}>Risk tier</label>
          <select style={select()} value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">All</option>
            <option value="0">0 — auto-approve</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3 — highest</option>
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#374151' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={ordered.length === 0} emptyText="No categories match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Category</th><th style={th()}>Risk</th><th style={th()}>Commission</th>
              <th style={th()}>Attributes</th><th style={th()}>Listings</th><th style={th()}>Status</th>
              <th style={th()}>Updated</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {ordered.map((c) => (
                <tr key={c.id}>
                  <td style={td()}>
                    <div style={{ paddingLeft: c.parent_id ? 18 : 0 }}>
                      {c.parent_id ? <span style={{ color: '#9ca3af' }}>↳ </span> : null}
                      <Link href={`/admin/marketplace/taxonomy/${c.id}`} style={{ fontWeight: 600, color: '#340075', textDecoration: 'none' }}>{c.name}</Link>
                      <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                        <code>{c.slug}</code>{c.parent_id ? <> · under <code>{nameById[c.parent_id] ?? c.parent_id}</code></> : null}
                      </div>
                    </div>
                  </td>
                  <td style={td()}>
                    <span style={{ fontWeight: 600, color: c.risk_tier === 0 ? '#15803d' : c.risk_tier >= 3 ? '#b91c1c' : '#9a3412' }}>{c.risk_tier}</span>
                  </td>
                  <td style={td()}>{(c.commission_bps / 100).toFixed(2)}%</td>
                  <td style={td()}>{attrCount(c)} field{attrCount(c) === 1 ? '' : 's'}{reqCount(c) > 0 ? <span style={{ color: '#9ca3af' }}> · {reqCount(c)} req</span> : null}</td>
                  <td style={td()}>{(c.listing_count ?? 0).toLocaleString('en-NG')}</td>
                  <td style={td()}><StatusBadge status={c.is_active ? 'active' : 'paused'} /></td>
                  <td style={td()}>{timeAgo(c.updated_at)}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 200 }}>
                      <Link href={`/admin/marketplace/taxonomy/${c.id}`} style={{ ...btn(), textDecoration: 'none', textAlign: 'center' }}>Edit</Link>
                      <input
                        placeholder="reason_code"
                        value={reasonDraft[c.id] ?? ''}
                        onChange={(e) => setReasonDraft((s) => ({ ...s, [c.id]: e.target.value }))}
                        style={{ padding: '0.3rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8rem' }}
                      />
                      <button
                        style={canManage && (reasonDraft[c.id] ?? '').trim() && busyId !== c.id ? (c.is_active ? btnDanger() : btnPrimary('#15803d')) : btnDisabled()}
                        disabled={!canManage || !(reasonDraft[c.id] ?? '').trim() || busyId === c.id}
                        onClick={() => void toggleActive(c)}
                      >{busyId === c.id ? '…' : c.is_active ? 'Disable' : 'Enable'}</button>
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
