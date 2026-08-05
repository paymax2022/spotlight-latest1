'use client';

import { useEffect, useState } from 'react';
import { listEarnRules, updateEarnRule, formatPoints } from '@/services/loyaltyAdminService';
import type { EarnRule, EarnRuleStatus } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../../events/_ui';
import { Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 } as const;

export default function EarnRulesPage() {
  const [rows, setRows] = useState<EarnRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleF, setModuleF] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listEarnRules({ module: moduleF || undefined, status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [moduleF, status]);

  async function editRate(r: EarnRule) {
    const v = window.prompt(`New points-per-₦ for "${r.action}" (current ${r.points_per_naira}). This creates a new versioned config:`, String(r.points_per_naira));
    if (v === null) return;
    const ppn = Number(v);
    if (Number.isNaN(ppn) || ppn < 0) { setMsg('Invalid rate.'); return; }
    setBusy(r.id); setMsg(null);
    try {
      const res = await updateEarnRule(r.id, { points_per_naira: ppn });
      setMsg(res.message + ` (now v${res.config_version}, audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function toggleStatus(r: EarnRule) {
    const next: EarnRuleStatus = r.status === 'active' ? 'disabled' : 'active';
    if (!window.confirm(`Set "${r.action}" to ${next}? Audited, versioned config change.`)) return;
    setBusy(r.id); setMsg(null);
    try {
      const res = await updateEarnRule(r.id, { status: next });
      setMsg(res.message + ` (now v${res.config_version}, audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Earn-rule configuration" subtitle="Points earned per action / module, versioned. Wire-up to payments, savings, tickets, cashless, referral and social." action={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <LoyaltyTabs active="earn-rules" />
      <DisclosureNote>Each edit creates a new <strong>versioned config</strong> — prior versions stay in the audit trail (NL-12). Points are non-cash (NL-4). Per-day caps are anti-abuse limits enforced server-side. Point values labelled <code>pts</code>.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={labelStyle}>Search</label>
          <Input placeholder="Action, module or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={labelStyle}>Module</label>
          <select value={moduleF} onChange={(e) => setModuleF(e.target.value)}>
            <option value="">All</option>
            <option value="payments">Payments</option>
            <option value="savings">Savings</option>
            <option value="tickets">Tickets</option>
            <option value="cashless">Cashless</option>
            <option value="referral">Referral</option>
            <option value="social">Social</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No earn rules match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Action</th><th style={thCell}>Module</th><th style={thCell}>Pts / ₦</th><th style={thCell}>Flat pts</th>
              <th style={thCell}>Daily cap</th><th style={thCell}>Status</th><th style={thCell}>Config v</th><th style={thCell}>Updated</th><th style={thCell}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>{r.action}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                  <td style={tdCell}><Badge status={r.module} /></td>
                  <td style={tdCell}>{r.points_per_naira || '—'}</td>
                  <td style={tdCell}>{r.flat_points ? formatPoints(r.flat_points) : '—'}</td>
                  <td style={tdCell}>{r.cap_points_per_day ? formatPoints(r.cap_points_per_day) : 'uncapped'}</td>
                  <td style={tdCell}><Badge status={r.status} /></td>
                  <td style={tdCell}>v{r.config_version}</td>
                  <td style={tdCell}>{fmtDate(r.updated_at)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <Button variant="primary" sm disabled={busy === r.id} onClick={() => editRate(r)}>{busy === r.id ? '…' : 'Edit rate'}</Button>
                      <Button variant="outline" sm disabled={busy === r.id} onClick={() => toggleStatus(r)}>{r.status === 'active' ? 'Disable' : 'Activate'}</Button>
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
