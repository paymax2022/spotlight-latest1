'use client';

import { useEffect, useState } from 'react';
import { getRouting, updateRouting } from '@/services/insuranceAdminService';
import type { RoutingRule, Provider } from '@/types/insuranceAdmin';
import { InsuranceTabs, DisclosureNote, StateBlock } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function InsuranceRoutingPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<'all' | 'mycover' | 'octamile'>('all');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRules(await getRouting()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function patchRule(id: string, change: Partial<RoutingRule>) {
    setSaved(false);
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      setRules(await updateRouting(rules));
      setSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const visible = providerFilter === 'all' ? rules : rules.filter((r) => r.provider === providerFilter);

  return (
    <Page>
      <PageHeader
        title="Routing table"
        subtitle="Maps each product line to a provider, underwriter and binding trigger. This table is the single source of truth at bind time."
        actions={
          <Button variant="primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save routing'}
          </Button>
        }
      />
      <InsuranceTabs active="catalog" />

      <DisclosureNote>
        The routing table is the single source of truth — no product line is hard-coded. The underwriter set here is disclosed on every policy bound through this rule.
      </DisclosureNote>

      <Card title="Product-line routing">
        <div style={{ marginBottom: 14, minWidth: 180 }}>
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as typeof providerFilter)}>
            <option value="all">All providers</option>
            <option value="mycover">MyCover.ai</option>
            <option value="octamile">Octamile</option>
          </select>
        </div>

        <StateBlock loading={loading} error={error} empty={visible.length === 0} emptyText="No routing rules for this filter.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Product line</th>
                  <th style={thCell}>Provider</th>
                  <th style={thCell}>Underwriter</th>
                  <th style={thCell}>Binding trigger</th>
                  <th style={thCell}>Priority</th>
                  <th style={thCell}>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><code style={{ fontSize: 13 }}>{r.product_line.replace(/_/g, ' ')}</code></td>
                    <td style={tdCell}>
                      <select value={r.provider} onChange={(e) => patchRule(r.id, { provider: e.target.value as Provider })}>
                        <option value="mycover">MyCover.ai</option>
                        <option value="octamile">Octamile</option>
                      </select>
                    </td>
                    <td style={tdCell}>
                      <Input value={r.underwriter} onChange={(e) => patchRule(r.id, { underwriter: e.target.value })} />
                    </td>
                    <td style={tdCell}>
                      <Input value={r.binding_trigger} onChange={(e) => patchRule(r.id, { binding_trigger: e.target.value })} />
                    </td>
                    <td style={{ ...tdCell, width: 90 }}>
                      <Input type="number" min={1} value={r.priority} onChange={(e) => patchRule(r.id, { priority: Number(e.target.value) })} />
                    </td>
                    <td style={tdCell}>
                      <input type="checkbox" checked={r.enabled} onChange={(e) => patchRule(r.id, { enabled: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {saved && <p style={{ color: colors.success, fontSize: 13, fontWeight: 600, marginTop: 13 }}>Routing saved.</p>}
        </StateBlock>
      </Card>
    </Page>
  );
}
