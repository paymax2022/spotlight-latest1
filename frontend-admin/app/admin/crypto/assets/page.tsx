'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListAssets, adminConfigAsset } from '@/services/cryptoAdminService';
import type { CryptoAsset } from '@/types/cryptoAdmin';
import {
  PageHeader, CryptoTabs, Card, StatusBadge, DisclosureNote, StateBlock, AuditNote,
  PermissionBanner, btn, btnPrimary, btnDisabled, th, td, input, label as lbl, textarea, fmtDate,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';

type FormState = {
  symbol: string;
  name: string;
  minorUnitScale: string;
  isActive: boolean;
  note: string;
};

const EMPTY_FORM: FormState = { symbol: '', name: '', minorUnitScale: '100000000', isActive: true, note: '' };

export default function CryptoAssetsPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CryptoAsset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await adminListAssets()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function startCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  }

  function startEdit(a: CryptoAsset) {
    setEditing(a);
    setForm({ symbol: a.symbol, name: a.name, minorUnitScale: String(a.minor_unit_scale), isActive: a.is_active, note: '' });
    setShowForm(true);
    setError(null);
  }

  const noteMissing = !form.note.trim();

  async function submit() {
    setError(null);
    if (!form.symbol.trim()) { setError('Symbol is required.'); return; }
    if (!form.name.trim()) { setError('Name is required.'); return; }
    const scale = Number(form.minorUnitScale);
    if (!Number.isInteger(scale) || scale <= 0) { setError('Minor unit scale must be a positive integer.'); return; }
    // Block empty submit — every catalogue change requires an operator note for
    // traceability, even though this admin endpoint has no dedicated audit body
    // field yet; the note is a hard client-side gate per console convention.
    if (noteMissing) { setError('An operator note is required to change the asset catalogue.'); return; }

    setBusy(true); setMsg(null);
    try {
      const result = await adminConfigAsset({
        symbol: form.symbol.trim().toUpperCase(),
        name: form.name.trim(),
        minor_unit_scale: scale,
        is_active: form.isActive,
      });
      setMsg(`Asset ${result.symbol} ${editing ? 'updated' : 'created'} (${result.is_active ? 'active' : 'inactive'}). Note: "${form.note.trim()}"`);
      setShowForm(false);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Crypto — Asset Catalogue"
        subtitle="Admin-curated list of tradable assets. Deactivating an asset blocks new buy orders immediately; existing holdings are unaffected."
        action={<button style={canAdmin ? btnPrimary() : btnDisabled()} disabled={!canAdmin} onClick={startCreate}>+ New asset</button>}
      />
      <CryptoTabs active="assets" />
      <DisclosureNote>
        Backed by <code>GET/POST /api/v1/admin/crypto/assets</code> (RBAC <code>crypto.admin</code>). POST upserts by
        symbol (create or update). <code>minor_unit_scale</code> is the number of integer asset-minor-units per one
        whole unit — this must never change once real holdings exist for the asset, or existing balances will be
        mis-scaled; treat it as append-only in practice.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      {showForm && (
        <Card title={editing ? `Edit ${editing.symbol}` : 'New asset'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <div>
              <label style={lbl()}>Symbol</label>
              <input style={input()} value={form.symbol} disabled={!!editing} placeholder="BTC" onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            </div>
            <div>
              <label style={lbl()}>Name</label>
              <input style={input()} value={form.name} placeholder="Bitcoin" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label style={lbl()}>Minor unit scale</label>
              <input style={input()} value={form.minorUnitScale} placeholder="100000000" onChange={(e) => setForm({ ...form, minorUnitScale: e.target.value })} />
            </div>
            <div>
              <label style={lbl()}>Status</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Active / tradable
              </label>
            </div>
          </div>

          <div style={{ marginTop: '0.75rem' }}>
            <label style={lbl()}>Operator note (mandatory — why is this catalogue change being made?)</label>
            <textarea
              style={textarea()}
              placeholder="e.g. Listing per compliance sign-off ref CR-2026-014; or delisting due to low liquidity"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              style={canAdmin && !noteMissing && !busy ? btnPrimary() : btnDisabled()}
              disabled={!canAdmin || noteMissing || busy}
              onClick={() => void submit()}
            >{busy ? '…' : editing ? 'Save changes' : 'Create asset'}</button>
            <button style={btn()} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
          {noteMissing && <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.4rem' }}>Submit is disabled until an operator note is entered.</p>}
        </Card>
      )}

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No assets in the catalogue yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Symbol</th><th style={th()}>Name</th><th style={th()}>Minor unit scale</th>
              <th style={th()}>Status</th><th style={th()}>Updated</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...td(), fontWeight: 700 }}>{a.symbol}</td>
                  <td style={td()}>{a.name}</td>
                  <td style={td()}>{a.minor_unit_scale.toLocaleString('en-NG')}</td>
                  <td style={td()}><StatusBadge status={a.is_active ? 'active' : 'inactive'} /></td>
                  <td style={td()}>{fmtDate(a.updated_at)}</td>
                  <td style={td()}>
                    <button style={canAdmin ? btn() : btnDisabled()} disabled={!canAdmin} onClick={() => startEdit(a)}>Edit</button>
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
