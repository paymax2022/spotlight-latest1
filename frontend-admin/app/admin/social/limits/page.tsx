'use client';

import { useEffect, useState } from 'react';
import { getLimits, updateLimits, formatNaira } from '@/services/socialAdminService';
import type { VelocityLimit } from '@/types/socialAdmin';
import { SocialTabs, DisclosureNote, StateBlock, AuditNote, timeAgo } from '../../savings/_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Velocity & AML limits"
        subtitle="Per-transaction, daily and monthly caps plus AML review thresholds, configured per KYC tier."
        actions={<><Button variant="outline" onClick={load}>Reset</Button><Button variant="primary" onClick={onSave} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button></>}
      />
      <SocialTabs active="limits" />
      <DisclosureNote>NL-10 — limits are enforced fail-closed: a send is blocked when it would breach the sender&apos;s tier cap, and any single transaction at or above the AML review threshold is held for review. Saving any change writes a before/after entry to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}
      {updatedAt && <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: 0 }}>Last updated {timeAgo(updatedAt)}</p>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No limit rules configured.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Scope</th><th style={thCell}>Per txn (₦)</th><th style={thCell}>Daily (₦)</th><th style={thCell}>Monthly (₦)</th>
              <th style={thCell}>Daily count</th><th style={thCell}>AML review ≥ (₦)</th><th style={thCell}>Enabled</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={tdCell}><Badge text={l.scope} color={colors.info} /><div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 4 }}>{l.label}</div></td>
                  <td style={tdCell}><input style={{ width: 120 }} type="number" value={toNaira(l.per_txn_kobo)} onChange={(e) => patch(l.id, 'per_txn_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: colors.muted }}>{formatNaira(l.per_txn_kobo)}</div></td>
                  <td style={tdCell}><input style={{ width: 120 }} type="number" value={toNaira(l.daily_kobo)} onChange={(e) => patch(l.id, 'daily_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: colors.muted }}>{formatNaira(l.daily_kobo)}</div></td>
                  <td style={tdCell}><input style={{ width: 130 }} type="number" value={toNaira(l.monthly_kobo)} onChange={(e) => patch(l.id, 'monthly_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: colors.muted }}>{formatNaira(l.monthly_kobo)}</div></td>
                  <td style={tdCell}><input style={{ width: 80 }} type="number" value={l.daily_count} onChange={(e) => patch(l.id, 'daily_count', parseInt(e.target.value, 10) || 0)} /></td>
                  <td style={tdCell}><input style={{ width: 130 }} type="number" value={toNaira(l.aml_review_threshold_kobo)} onChange={(e) => patch(l.id, 'aml_review_threshold_kobo', toKobo(e.target.value))} /><div style={{ fontSize: '0.7rem', color: colors.muted }}>{formatNaira(l.aml_review_threshold_kobo)}</div></td>
                  <td style={tdCell}><input type="checkbox" checked={l.enabled} onChange={(e) => patch(l.id, 'enabled', e.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
