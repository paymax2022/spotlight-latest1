'use client';

import { useEffect, useState } from 'react';
import { getCatalogue, toggleFlag, toggleCorridor, toggleCurrency } from '@/services/fxAdminService';
import type { FxSettingsCatalogue } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, th, td } from '../_ui';

function Toggle({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} aria-pressed={on}
      style={{ width: 44, height: 24, borderRadius: 9999, border: 'none', cursor: 'pointer', position: 'relative', background: on ? '#1d4ed8' : '#d1d5db', transition: 'background .15s' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );
}

export default function FxSettingsPage() {
  const [cat, setCat] = useState<FxSettingsCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() { setLoading(true); try { setCat(await getCatalogue()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  async function act(key: string, fn: () => Promise<unknown>) { setBusy(key); try { await fn(); await load(); } finally { setBusy(null); } }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="FX Settings" subtitle="Feature flags, corridor & currency / rail catalogues (§13-N)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="settings" />

      {loading || !cat ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
        <>
          <Card title="Feature flags">
            {cat.flags.map((f) => (
              <div key={f.key} style={rowStyle}>
                <div><strong>{f.label}</strong><div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{f.key}</div></div>
                <Toggle on={f.enabled} busy={busy === f.key} onClick={() => act(f.key, () => toggleFlag(f.key, !f.enabled))} />
              </div>
            ))}
            <p style={hint}>Flags gate modules at runtime; changes are audit-logged. No flag, no traffic.</p>
          </Card>

          <Card title="Corridor catalogue">
            <table style={tableStyle}>
              <thead><tr style={theadRow}><th style={th()}>Corridor</th><th style={th()}>Default provider</th><th style={th()}>Status</th><th style={th()}></th></tr></thead>
              <tbody>
                {cat.corridors.map((c) => (
                  <tr key={c.corridor} style={trStyle}>
                    <td style={td()}><strong>{c.corridor}</strong></td>
                    <td style={{ ...td(), textTransform: 'capitalize' }}>{c.defaultProvider}</td>
                    <td style={td()}><Badge status={c.enabled ? 'successful' : 'failed'} label={c.enabled ? 'Enabled' : 'Disabled'} /></td>
                    <td style={{ ...td(), textAlign: 'right' }}><Toggle on={c.enabled} busy={busy === c.corridor} onClick={() => act(c.corridor, () => toggleCorridor(c.corridor, !c.enabled))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <Card title="Currency catalogue">
              <table style={tableStyle}>
                <thead><tr style={theadRow}><th style={th()}>Code</th><th style={th()}>Name</th><th style={th()}>Kind</th><th style={th()}></th></tr></thead>
                <tbody>
                  {cat.currencies.map((c) => (
                    <tr key={c.code} style={trStyle}>
                      <td style={td()}><strong>{c.code}</strong></td>
                      <td style={td()}>{c.name}</td>
                      <td style={{ ...td(), textTransform: 'capitalize' }}>{c.kind}</td>
                      <td style={{ ...td(), textAlign: 'right' }}><Toggle on={c.enabled} busy={busy === c.code} onClick={() => act(c.code, () => toggleCurrency(c.code, !c.enabled))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Rail catalogue">
              <table style={tableStyle}>
                <thead><tr style={theadRow}><th style={th()}>Rail</th><th style={th()}>Status</th></tr></thead>
                <tbody>
                  {cat.rails.map((r) => (
                    <tr key={r.rail} style={trStyle}>
                      <td style={td()}><strong>{r.label}</strong><div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{r.rail}</div></td>
                      <td style={td()}><Badge status={r.enabled ? 'successful' : 'failed'} label={r.enabled ? 'Enabled' : 'Disabled'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={hint}>Admin users & RBAC are managed in the platform Roles / RBAC Settings pages.</p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid #f3f4f6' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
const theadRow: React.CSSProperties = { textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' };
const trStyle: React.CSSProperties = { borderBottom: '1px solid #f3f4f6' };
const hint: React.CSSProperties = { fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' };
