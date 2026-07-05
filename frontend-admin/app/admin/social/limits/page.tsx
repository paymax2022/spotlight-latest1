'use client';

import { useEffect, useState } from 'react';
import { getLimits, updateLimits, formatNaira } from '@/services/socialAdminService';
import type { VelocityLimit } from '@/types/socialAdmin';
import { PageHeader, SocialTabs, Card, Badge, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, th, td, input, timeAgo } from '../../savings/_ui';

// kobo <-> naira helpers for the editable money inputs
const toNaira = (kobo: number) => (kobo / 100).toString();
const toKobo = (naira: string) => Math.round((parseFloat(naira) || 0) * 100);

export default function LimitsPage() {
  const [rows, setRows] = useState<VelocityLimit[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null); setMsg(null);
    try {
      const data = await getLimits();
      setRows(data.limits); setUpdatedAt(data.updated_at); setDirty(false);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function patch(id: string, field: keyof VelocityLimit, value: number | boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setDirty(true);
  }

  async function onSave() {
    setSaving(true); setMsg(null);
    try {
      const res = await updateLimits(rows);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Velocity & AML limits" subtitle="Per-transaction, daily and monthly caps plus AML review thresholds, configured per KYC tier." action={<div style={{ display: 'flex', gap: '0.5rem' }}><button onClick={load} style={btn()}>Reset</button><button onClick={onSave} style={btnPrimary()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>} />
      <SocialTabs active="limits" />
      <DisclosureNote>NL-10 — limits are enforced fail-closed: a send is blocked when it would breach the sender&apos;s tier cap, and any single transaction at or above the AML review threshold is held for review. Saving any change writes a before/after entry to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}
      {updatedAt && <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 0 }}>Last updated {timeAgo(updatedAt)}</p>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No limit rules configured.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Scope</th><th style={th()}>Per txn (₦)</th><th style={th()}>Daily (₦)</th><th style={th()}>Monthly (₦)</th>
              <th style={th()}>Daily count</th><th style={th()}>AML review ≥ (₦)</th><th style={th()}>Enabled</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={td()}><Badge status="normal" label={l.scope} /><div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>{l.label}</div></td>
                  <td style={td()}><input style={{ ...input(), width: 120 }} type="number" value={toNaira(l.per_txn_kobo)} onChange={(e) => patch(l.id, 'per_txn_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{formatNaira(l.per_txn_kobo)}</div></td>
                  <td style={td()}><input style={{ ...input(), width: 120 }} type="number" value={toNaira(l.daily_kobo)} onChange={(e) => patch(l.id, 'daily_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{formatNaira(l.daily_kobo)}</div></td>
                  <td style={td()}><input style={{ ...input(), width: 130 }} type="number" value={toNaira(l.monthly_kobo)} onChange={(e) => patch(l.id, 'monthly_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{formatNaira(l.monthly_kobo)}</div></td>
                  <td style={td()}><input style={{ ...input(), width: 80 }} type="number" value={l.daily_count} onChange={(e) => patch(l.id, 'daily_count', parseInt(e.target.value, 10) || 0)} /></td>
                  <td style={td()}><input style={{ ...input(), width: 130 }} type="number" value={toNaira(l.aml_review_threshold_kobo)} onChange={(e) => patch(l.id, 'aml_review_threshold_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{formatNaira(l.aml_review_threshold_kobo)}</div></td>
                  <td style={td()}><input type="checkbox" checked={l.enabled} onChange={(e) => patch(l.id, 'enabled', e.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
