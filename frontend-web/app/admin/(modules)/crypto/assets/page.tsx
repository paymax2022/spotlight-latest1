'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListAssets, adminConfigAsset } from '@/services/cryptoAdminService';
import type { CryptoAsset } from '@/types/cryptoAdmin';
import {
  CryptoTabs, StatusBadge, DisclosureNote, StateBlock, AuditNote,
  PermissionBanner, label as lbl, textarea, fmtDate,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Crypto — Asset Catalogue"
        subtitle="Admin-curated list of tradable assets. Deactivating an asset blocks new buy orders immediately; existing holdings are unaffected."
        actions={<Button variant="primary" disabled={!canAdmin} onClick={startCreate}>+ New asset</Button>}
      />
      <CryptoTabs active="assets" />
      <DisclosureNote>
        Backed by <code>GET/POST /api/v1/admin/crypto/assets</code> (RBAC <code>crypto.admin</code>). POST upserts by
        symbol (create or update). <code>minor_unit_scale</code> is the number of integer asset-minor-units per one
        whole unit — this must never change once real holdings exist for the asset, or existing balances will be
        mis-scaled; treat it as append-only in practice.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      {showForm && (
        <Card title={editing ? `Edit ${editing.symbol}` : 'New asset'} style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginTop: 12 }}>
            <div>
              <label style={lbl()}>Symbol</label>
              <Input value={form.symbol} disabled={!!editing} placeholder="BTC" onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            </div>
            <div>
              <label style={lbl()}>Name</label>
              <Input value={form.name} placeholder="Bitcoin" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label style={lbl()}>Minor unit scale</label>
              <Input value={form.minorUnitScale} placeholder="100000000" onChange={(e) => setForm({ ...form, minorUnitScale: e.target.value })} />
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
            <Button
              variant="primary"
              disabled={!canAdmin || noteMissing || busy}
              onClick={() => void submit()}
            >{busy ? '…' : editing ? 'Save changes' : 'Create asset'}</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
          {noteMissing && <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.4rem' }}>Submit is disabled until an operator note is entered.</p>}
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading ? 14 : 0 }}>
          <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No assets in the catalogue yet.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Symbol</th><th style={thCell}>Name</th><th style={thCell}>Minor unit scale</th>
                <th style={thCell}>Status</th><th style={thCell}>Updated</th><th style={thCell}>Action</th>
              </tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td style={{ ...tdCell, fontWeight: 700 }}>{a.symbol}</td>
                    <td style={tdCell}>{a.name}</td>
                    <td style={tdCell}>{a.minor_unit_scale.toLocaleString('en-NG')}</td>
                    <td style={tdCell}><StatusBadge status={a.is_active ? 'active' : 'inactive'} /></td>
                    <td style={tdCell}>{fmtDate(a.updated_at)}</td>
                    <td style={tdCell}>
                      <Button variant="outline" sm disabled={!canAdmin} onClick={() => startEdit(a)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>
    </Page>
  );
}
