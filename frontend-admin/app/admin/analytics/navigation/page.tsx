'use client';

import { useCallback, useEffect, useState } from 'react';
import { getNavigationAnalytics, type NavAnalytics } from '@/services/analyticsService';
import { AdminUsersRequestError } from '@/services/usersService';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';
import Sparkline from './Sparkline';

const RANGES = ['7d', '30d', '90d'] as const;
const SURFACES = ['all', 'mobile', 'web'] as const;

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: NavAnalytics }
  | { kind: 'empty' }
  | { kind: 'disabled' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export default function NavigationAnalyticsPage() {
  const [range, setRange] = useState<string>('30d');
  const [surface, setSurface] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async (): Promise<State> => {
    try {
      const res = await getNavigationAnalytics({ range, surface, search });
      if (!res.enabled) return { kind: 'disabled' };
      const d = res.data;
      if (!d || ((d.topScreens ?? []).length === 0 && (d.timeseries ?? []).length === 0 && !d.surfaceSplit?.total)) {
        return { kind: 'empty' };
      }
      return { kind: 'ready', data: d };
    } catch (e) {
      if (e instanceof AdminUsersRequestError && e.status === 403) return { kind: 'forbidden' };
      return { kind: 'error', message: e instanceof Error ? e.message : 'Request failed' };
    }
  }, [range, surface, search]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void load().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  const chip = (active: boolean) => ({
    padding: '6px 12px',
    borderRadius: 6,
    border: `1px solid ${active ? colors.primary : colors.border}`,
    background: active ? colors.primary : 'transparent',
    color: active ? '#fff' : colors.text,
    cursor: 'pointer' as const,
    fontSize: 13,
  });

  return (
    <Page>
      <PageHeader title="Navigation Analytics" subtitle="Screen views across mobile and web" />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <div role="group" aria-label="Range" style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} style={chip(range === r)} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Surface" style={{ display: 'flex', gap: 6 }}>
          {SURFACES.map((s) => (
            <button key={s} type="button" aria-pressed={surface === s} style={chip(surface === s)} onClick={() => setSurface(s)}>
              {s}
            </button>
          ))}
        </div>
        <Input
          aria-label="Search routes"
          placeholder="Search route..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ maxWidth: 240 }}
        />
      </div>

      {state.kind === 'loading' && <p style={{ color: colors.muted }}>Loading navigation analytics...</p>}
      {state.kind === 'disabled' && <Card><p>Navigation telemetry not enabled</p></Card>}
      {state.kind === 'forbidden' && (
        <Card><p>You do not have permission to view navigation analytics.</p></Card>
      )}
      {state.kind === 'empty' && <Card><p>No navigation data yet</p></Card>}
      {state.kind === 'error' && (
        <Card>
          <p role="alert" style={{ color: colors.danger }}>{state.message}</p>
          <Button onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
        </Card>
      )}
      {state.kind === 'ready' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div data-testid="surface-split" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {(['mobile', 'web', 'total'] as const).map((k) => (
              <Card key={k} title={k[0].toUpperCase() + k.slice(1)}>
                <div data-testid={`split-${k}`} style={{ fontSize: 24, fontWeight: 600 }}>
                  {state.data.surfaceSplit?.[k] ?? 0}
                </div>
              </Card>
            ))}
          </div>
          <Card title="Views over time">
            <Sparkline points={state.data.timeseries ?? []} />
          </Card>
          <Card title="Top screens">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Route</th>
                  <th style={thCell}>Views</th>
                  <th style={thCell}>Users</th>
                </tr>
              </thead>
              <tbody>
                {(state.data.topScreens ?? []).map((s) => (
                  <tr key={s.route}>
                    <td style={tdCell}>{s.route}</td>
                    <td style={tdCell}>{s.views}</td>
                    <td style={tdCell}>{s.users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </Page>
  );
}
