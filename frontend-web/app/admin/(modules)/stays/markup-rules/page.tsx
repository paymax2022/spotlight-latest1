'use client';

import { useEffect, useState } from 'react';
import { getMarkupRules, updateMarkupRules } from '@/services/staysAdminService';
import type { MarkupRule } from '@/types/staysAdmin';
import { StaysTabs, Badge, timeAgo, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Markup & commission rules"
        subtitle="Pricing rules engine — markup over net rate (bedbank) and direct-rail commission take. Scoped by supplier, destination, tier, season or global."
        actions={
          <>
            <Button variant="outline" onClick={load}>Refresh</Button>
            <Button variant="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </>
        }
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        Rules apply by <strong>priority — lower number = higher precedence</strong>. The most specific matching enabled rule (lowest priority value) wins for a given supplier/destination/tier/season; <code>global</code> (highest number) is the fallback. Disabled rules are skipped entirely.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={rules.length === 0} emptyText="No markup rules configured.">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: colors.text }}>{`Rules (${rules.length})`}</h2>
            {dirty ? <span style={{ fontSize: '0.75rem', color: colors.warning }}>Unsaved changes</span> : null}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Scope</th>
                  <th style={thCell}>Match</th>
                  <th style={thCell}>Markup %</th>
                  <th style={thCell}>Commission %</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>Priority</th>
                  <th style={thCell}>Enabled</th>
                  <th style={thCell}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} style={r.enabled ? undefined : { opacity: 0.55 }}>
                    <td style={tdCell}><Badge status={r.scope === 'global' ? 'normal' : 'draft'} label={r.scope} /></td>
                    <td style={tdCell}>{r.match}</td>
                    <td style={tdCell}>
                      <Input
                        type="number"
                        style={{ width: 90 }}
                        value={r.markup_pct}
                        min={0}
                        step={0.5}
                        onChange={(e) => patch(r.id, { markup_pct: Number(e.target.value) })}
                      />
                    </td>
                    <td style={tdCell}>
                      <Input
                        type="number"
                        style={{ width: 90 }}
                        value={r.commission_pct}
                        min={0}
                        step={0.5}
                        onChange={(e) => patch(r.id, { commission_pct: Number(e.target.value) })}
                      />
                    </td>
                    <td style={tdCell}><Badge status={r.rail === 'ALL' ? 'normal' : r.rail} label={r.rail} /></td>
                    <td style={tdCell}>
                      <Input
                        type="number"
                        style={{ width: 80 }}
                        value={r.priority}
                        min={0}
                        step={1}
                        onChange={(e) => patch(r.id, { priority: Number(e.target.value) })}
                      />
                    </td>
                    <td style={tdCell}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.82rem' }}>
                        <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.id, { enabled: e.target.checked })} />
                        {r.enabled ? 'On' : 'Off'}
                      </label>
                    </td>
                    <td style={tdCell}>{timeAgo(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </StateBlock>
    </Page>
  );
}
