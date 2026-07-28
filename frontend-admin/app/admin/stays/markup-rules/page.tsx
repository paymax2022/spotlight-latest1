'use client';

import { useEffect, useState } from 'react';
import { getMarkupRules, updateMarkupRules } from '@/services/staysAdminService';
import type { MarkupRule } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Badge, btn, btnPrimary, th, td, input, timeAgo, StateBlock, DisclosureNote } from '../_ui';

export default function StaysMarkupRulesPage() {
  const [rules, setRules] = useState<MarkupRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setLoading(true); setError(null); setDirty(false);
    try { setRules(await getMarkupRules()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function patch(id: string, change: Partial<MarkupRule>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
    setDirty(true);
  }

  async function save() {
    setSaving(true); setError(null);
    try { await updateMarkupRules(rules); await load(); }
    catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Markup & commission rules"
        subtitle="Pricing rules engine — markup over net rate (bedbank) and direct-rail commission take. Scoped by supplier, destination, tier, season or global."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={load} style={btn()}>Refresh</button>
            <button onClick={save} disabled={saving || !dirty} style={btnPrimary()}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        }
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        Rules apply by <strong>priority — lower number = higher precedence</strong>. The most specific matching enabled rule (lowest priority value) wins for a given supplier/destination/tier/season; <code>global</code> (highest number) is the fallback. Disabled rules are skipped entirely.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={rules.length === 0} emptyText="No markup rules configured.">
        <Card title={`Rules (${rules.length})`} right={dirty ? <span style={{ fontSize: '0.75rem', color: '#b45309' }}>Unsaved changes</span> : undefined}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Scope</th>
                  <th style={th()}>Match</th>
                  <th style={th()}>Markup %</th>
                  <th style={th()}>Commission %</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>Priority</th>
                  <th style={th()}>Enabled</th>
                  <th style={th()}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} style={r.enabled ? undefined : { opacity: 0.55 }}>
                    <td style={td()}><Badge status={r.scope === 'global' ? 'normal' : 'draft'} label={r.scope} /></td>
                    <td style={td()}>{r.match}</td>
                    <td style={td()}>
                      <input
                        type="number"
                        style={{ ...input(), width: 90 }}
                        value={r.markup_pct}
                        min={0}
                        step={0.5}
                        onChange={(e) => patch(r.id, { markup_pct: Number(e.target.value) })}
                      />
                    </td>
                    <td style={td()}>
                      <input
                        type="number"
                        style={{ ...input(), width: 90 }}
                        value={r.commission_pct}
                        min={0}
                        step={0.5}
                        onChange={(e) => patch(r.id, { commission_pct: Number(e.target.value) })}
                      />
                    </td>
                    <td style={td()}><Badge status={r.rail === 'ALL' ? 'normal' : r.rail} label={r.rail} /></td>
                    <td style={td()}>
                      <input
                        type="number"
                        style={{ ...input(), width: 80 }}
                        value={r.priority}
                        min={0}
                        step={1}
                        onChange={(e) => patch(r.id, { priority: Number(e.target.value) })}
                      />
                    </td>
                    <td style={td()}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.82rem' }}>
                        <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.id, { enabled: e.target.checked })} />
                        {r.enabled ? 'On' : 'Off'}
                      </label>
                    </td>
                    <td style={td()}>{timeAgo(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </StateBlock>
    </div>
  );
}
