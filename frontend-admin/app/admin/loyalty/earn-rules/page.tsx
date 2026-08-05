'use client';

import { useEffect, useState } from 'react';
import { listEarnRules, updateEarnRule, formatPoints } from '@/services/loyaltyAdminService';
import type { EarnRule, EarnRuleStatus } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, th, td, input, label, select, fmtDate } from '../../events/_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

export default function EarnRulesPage() {
  const [rows, setRows] = useState<EarnRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleF, setModuleF] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ rule: EarnRule; next: EarnRuleStatus } | null>(null);

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

  function askToggle(r: EarnRule) {
    const next: EarnRuleStatus = r.status === 'active' ? 'disabled' : 'active';
    setMsg(null);
    setPending({ rule: r, next });
  }

  // reason is captured as an operator acknowledgement for the audit trail;
  // updateEarnRule does not accept a reason argument (signature unchanged).
  async function confirmToggle(_reason: string) {
    if (!pending) return;
    const { rule: r, next } = pending;
    setBusy(r.id); setMsg(null);
    try {
      const res = await updateEarnRule(r.id, { status: next });
      setMsg(res.message + ` (now v${res.config_version}, audit ${res.audit_id})`);
      setPending(null);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Earn-rule configuration" subtitle="Points earned per action / module, versioned. Wire-up to payments, savings, tickets, cashless, referral and social." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LoyaltyTabs active="earn-rules" />
      <DisclosureNote>Each edit creates a new <strong>versioned config</strong> — prior versions stay in the audit trail (NL-12). Points are non-cash (NL-4). Per-day caps are anti-abuse limits enforced server-side. Point values labelled <code>pts</code>.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Action, module or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Module</label>
          <select style={select()} value={moduleF} onChange={(e) => setModuleF(e.target.value)}>
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
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No earn rules match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Action</th><th style={th()}>Module</th><th style={th()}>Pts / ₦</th><th style={th()}>Flat pts</th>
              <th style={th()}>Daily cap</th><th style={th()}>Status</th><th style={th()}>Config v</th><th style={th()}>Updated</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.action}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}><Badge status={r.module} /></td>
                  <td style={td()}>{r.points_per_naira || '—'}</td>
                  <td style={td()}>{r.flat_points ? formatPoints(r.flat_points) : '—'}</td>
                  <td style={td()}>{r.cap_points_per_day ? formatPoints(r.cap_points_per_day) : 'uncapped'}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>v{r.config_version}</td>
                  <td style={td()}>{fmtDate(r.updated_at)}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button style={btnPrimary()} disabled={busy === r.id} onClick={() => editRate(r)}>{busy === r.id ? '…' : 'Edit rate'}</button>
                      <button style={btn()} disabled={busy === r.id} onClick={() => askToggle(r)}>{r.status === 'active' ? 'Disable' : 'Activate'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {pending && (
        <ConfirmDialog
          open
          level="warning"
          title={pending.next === 'active' ? 'Activate earn rule' : 'Disable earn rule'}
          description={`"${pending.rule.action}" → ${pending.next}. This creates a new versioned, money-affecting config.`}
          reasons={[
            'Changes how members earn points going forward — a versioned config change.',
            'Prior versions stay in the audit trail (NL-12).',
            'Recorded in the audit log with your name, reason and timestamp.',
          ]}
          requireReason
          reasonPlaceholder="Why are you changing this earn rule?"
          busy={busy === pending.rule.id}
          confirmLabel={pending.next === 'active' ? 'Activate' : 'Disable'}
          onConfirm={confirmToggle}
          onCancel={() => {
            if (busy !== pending.rule.id) setPending(null);
          }}
        />
      )}
    </div>
  );
}
