'use client';

// Central Commission & Profit — rate-card management. Displays every commission_config
// row grouped by service_category, with an edit modal + add form. The UI shows ₦
// (kobo/100) and % (bps/100) but ALWAYS converts back to integer kobo/bps on submit
// (pctToBps / nairaToKobo). Floats never cross the wire for money.

import { useEffect, useMemo, useState } from 'react';
import {
  listConfig, createConfig, updateConfig, toggleConfig,
  bpsToPct, pctToBps, koboToNaira, nairaToKobo, formatNaira, formatPct,
  FEE_MODELS, FEE_PAYERS, SERVICE_CATEGORIES,
  type Config, type ConfigInput, type FeeModel, type FeePayer,
} from '@/services/commissionService';
import { PageHeader, Card, Badge, CommissionTabs, StateBlock, th, td, label, input, select, btn } from './_ui';
import { colors } from '@/components/ui/vuexy';

type FormState = {
  serviceCategory: string; service: string; serviceSubtype: string;
  feeModel: FeeModel; feePayer: FeePayer; currency: string;
  commissionPct: string; platformChargePct: string; convenienceFeeNaira: string; fixedFeeNaira: string;
  active: boolean; notes: string;
};

const EMPTY_FORM: FormState = {
  serviceCategory: SERVICE_CATEGORIES[0], service: '', serviceSubtype: '',
  feeModel: 'commission', feePayer: 'customer', currency: 'NGN',
  commissionPct: '', platformChargePct: '', convenienceFeeNaira: '', fixedFeeNaira: '',
  active: true, notes: '',
};

function formFromConfig(c: Config): FormState {
  return {
    serviceCategory: c.serviceCategory, service: c.service, serviceSubtype: c.serviceSubtype,
    feeModel: (c.feeModel || 'none') as FeeModel, feePayer: (c.feePayer || 'none') as FeePayer, currency: c.currency || 'NGN',
    commissionPct: c.commissionBps ? String(bpsToPct(c.commissionBps)) : '',
    platformChargePct: c.platformChargeBps ? String(bpsToPct(c.platformChargeBps)) : '',
    convenienceFeeNaira: c.convenienceFeeKobo ? String(koboToNaira(c.convenienceFeeKobo)) : '',
    fixedFeeNaira: c.fixedFeeKobo ? String(koboToNaira(c.fixedFeeKobo)) : '',
    active: c.active, notes: c.notes ?? '',
  };
}

// Convert the UI form (% and ₦ strings) into the integer-kobo/bps ConfigInput.
function formToInput(f: FormState): ConfigInput {
  return {
    serviceCategory: f.serviceCategory.trim(), service: f.service.trim(), serviceSubtype: f.serviceSubtype.trim(),
    feeModel: f.feeModel, feePayer: f.feePayer, currency: f.currency.trim() || 'NGN',
    commissionBps: pctToBps(parseFloat(f.commissionPct) || 0),
    platformChargeBps: pctToBps(parseFloat(f.platformChargePct) || 0),
    convenienceFeeKobo: nairaToKobo(parseFloat(f.convenienceFeeNaira) || 0),
    fixedFeeKobo: nairaToKobo(parseFloat(f.fixedFeeNaira) || 0),
    active: f.active, notes: f.notes.trim(),
  };
}

export default function CommissionRatesPage() {
  const [rows, setRows] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [editing, setEditing] = useState<Config | null>(null);   // edit modal target
  const [creating, setCreating] = useState(false);               // add-form modal
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const list = await listConfig(categoryFilter ? { category: categoryFilter } : undefined);
      setRows(list.flat);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [categoryFilter]);

  const grouped = useMemo(() => {
    const g: Record<string, Config[]> = {};
    for (const c of rows) (g[c.serviceCategory] ??= []).push(c);
    return g;
  }, [rows]);

  function openEdit(c: Config) { setEditing(c); setCreating(false); setForm(formFromConfig(c)); setSaveErr(null); }
  function openCreate() { setCreating(true); setEditing(null); setForm(EMPTY_FORM); setSaveErr(null); }
  function closeModal() { setEditing(null); setCreating(false); }

  async function save() {
    if (!form.service.trim() || !form.serviceCategory.trim()) { setSaveErr('Service category and service are required.'); return; }
    setSaving(true); setSaveErr(null);
    try {
      const payload = formToInput(form);
      if (editing) await updateConfig(editing.id, payload);
      else await createConfig(payload);
      closeModal();
      await load();
    } catch (e) { setSaveErr(String(e)); }
    finally { setSaving(false); }
  }

  async function onToggle(c: Config) {
    setBusyId(c.id);
    try { await toggleConfig(c.id, !c.active); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  const categories = Object.keys(grouped).sort();

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Commission & Profit"
        subtitle="Central rate card for every Spotlight super-app service. Rates are basis points (shown as %), money is kobo (shown as ₦). Edits convert back to integer minor units on save."
        action={<button onClick={openCreate} style={btn('primary')}>+ Add service / subtype</button>}
      />
      <CommissionTabs active="rates" />

      <Card title="Filter">
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Service category</label>
          <select style={{ ...select(), maxWidth: 260 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </Card>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No commission config rows.">
        {categories.map((cat) => (
          <Card key={cat} title={cat.replace(/_/g, ' ')} action={<Badge label={`${grouped[cat].length} services`} tone="neutral" />}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Service</th>
                    <th style={th()}>Subtype</th>
                    <th style={th()}>Fee model</th>
                    <th style={th()}>Commission %</th>
                    <th style={th()}>Platform %</th>
                    <th style={th()}>Convenience ₦</th>
                    <th style={th()}>Fixed ₦</th>
                    <th style={th()}>Payer</th>
                    <th style={th()}>Active</th>
                    <th style={th()}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[cat].map((c) => (
                    <tr key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
                      <td style={{ ...td(), fontWeight: 600 }}>{c.service}</td>
                      <td style={td()}>{c.serviceSubtype || <span style={{ color: colors.muted }}>—</span>}</td>
                      <td style={td()}><Badge label={c.feeModel.replace(/_/g, ' ')} tone="info" /></td>
                      <td style={td()}>{c.commissionBps ? formatPct(c.commissionBps) : <span style={{ color: colors.muted }}>—</span>}</td>
                      <td style={td()}>{c.platformChargeBps ? formatPct(c.platformChargeBps) : <span style={{ color: colors.muted }}>—</span>}</td>
                      <td style={td()}>{c.convenienceFeeKobo ? formatNaira(c.convenienceFeeKobo) : <span style={{ color: colors.muted }}>—</span>}</td>
                      <td style={td()}>{c.fixedFeeKobo ? formatNaira(c.fixedFeeKobo) : <span style={{ color: colors.muted }}>—</span>}</td>
                      <td style={td()}>{c.feePayer}</td>
                      <td style={td()}><Badge label={c.active ? 'Active' : 'Inactive'} tone={c.active ? 'ok' : 'off'} /></td>
                      <td style={td()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => openEdit(c)} style={btn()}>Edit</button>
                          <button onClick={() => onToggle(c)} disabled={busyId === c.id} style={btn(c.active ? 'danger' : 'ghost')}>
                            {busyId === c.id ? '…' : c.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </StateBlock>

      {(editing || creating) && (
        <ConfigModal
          title={editing ? `Edit — ${editing.service}${editing.serviceSubtype ? ` / ${editing.serviceSubtype}` : ''}` : 'Add service / subtype'}
          form={form} setForm={setForm} onCancel={closeModal} onSave={save} saving={saving} error={saveErr} isEdit={!!editing}
        />
      )}
    </div>
  );
}

// ── Edit / create modal ───────────────────────────────────────────────────────
function ConfigModal({ title, form, setForm, onCancel, onSave, saving, error, isEdit }: {
  title: string; form: FormState; setForm: (f: FormState) => void;
  onCancel: () => void; onSave: () => void; saving: boolean; error: string | null; isEdit: boolean;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const showCommission = form.feeModel === 'commission' || form.feeModel === 'commission_plus_fee';
  const showPlatform = form.feeModel === 'platform_charge';
  const showConvenience = form.feeModel === 'commission_plus_fee' || form.feeModel === 'platform_charge';
  const showFixed = form.feeModel === 'fixed';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 50, overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, padding: '1.25rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>{title}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={label()}>Service category</label>
            <input list="commission-categories" style={input()} value={form.serviceCategory} disabled={isEdit} onChange={(e) => set('serviceCategory', e.target.value)} />
            <datalist id="commission-categories">{SERVICE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label style={label()}>Service</label>
            <input style={input()} value={form.service} disabled={isEdit} onChange={(e) => set('service', e.target.value)} placeholder="e.g. electricity" />
          </div>
          <div>
            <label style={label()}>Service subtype (optional)</label>
            <input style={input()} value={form.serviceSubtype} disabled={isEdit} onChange={(e) => set('serviceSubtype', e.target.value)} placeholder="e.g. prepaid" />
          </div>
          <div>
            <label style={label()}>Currency</label>
            <input style={input()} value={form.currency} onChange={(e) => set('currency', e.target.value)} />
          </div>
          <div>
            <label style={label()}>Fee model</label>
            <select style={select()} value={form.feeModel} onChange={(e) => set('feeModel', e.target.value as FeeModel)}>
              {FEE_MODELS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Fee payer</label>
            <select style={select()} value={form.feePayer} onChange={(e) => set('feePayer', e.target.value as FeePayer)}>
              {FEE_PAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {showCommission && (
            <div>
              <label style={label()}>Commission %</label>
              <input type="number" step="0.01" min="0" style={input()} value={form.commissionPct} onChange={(e) => set('commissionPct', e.target.value)} placeholder="e.g. 1.5" />
            </div>
          )}
          {showPlatform && (
            <div>
              <label style={label()}>Platform charge %</label>
              <input type="number" step="0.01" min="0" style={input()} value={form.platformChargePct} onChange={(e) => set('platformChargePct', e.target.value)} placeholder="e.g. 0.75" />
            </div>
          )}
          {showConvenience && (
            <div>
              <label style={label()}>Convenience fee ₦</label>
              <input type="number" step="0.01" min="0" style={input()} value={form.convenienceFeeNaira} onChange={(e) => set('convenienceFeeNaira', e.target.value)} placeholder="e.g. 50" />
            </div>
          )}
          {showFixed && (
            <div>
              <label style={label()}>Fixed fee ₦</label>
              <input type="number" step="0.01" min="0" style={input()} value={form.fixedFeeNaira} onChange={(e) => set('fixedFeeNaira', e.target.value)} placeholder="e.g. 10" />
            </div>
          )}
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label style={label()}>Notes</label>
          <textarea style={{ ...input(), minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.75rem', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>

        <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.6rem' }}>
          Rates entered as % are stored as basis points (× 100); ₦ amounts are stored as kobo (× 100). Only integer minor units are sent to the backend.
        </p>

        {error && <p style={{ color: '#b91c1c', fontSize: '0.82rem', marginTop: '0.5rem' }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
          <button onClick={onCancel} style={btn()} disabled={saving}>Cancel</button>
          <button onClick={onSave} style={btn('primary')} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
