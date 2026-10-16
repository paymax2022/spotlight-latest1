'use client';

import { useRef, useState } from 'react';
import { getNavigationFunnel, type FunnelResult } from '@/services/analyticsService';
import { AdminUsersRequestError } from '@/services/usersService';
import { dropOff } from './funnelMath';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

const RANGES = ['7d', '30d', '90d'] as const;
const SURFACES = ['all', 'mobile', 'web'] as const;

type Step = { id: number; route: string };

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: FunnelResult }
  | { kind: 'empty' }
  | { kind: 'disabled' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export default function NavigationFunnelPage() {
  const nextId = useRef(3);
  const [steps, setSteps] = useState<Step[]>([
    { id: 1, route: '' },
    { id: 2, route: '' },
  ]);
  const [range, setRange] = useState<string>('30d');
  const [surface, setSurface] = useState<string>('all');
  const [gap, setGap] = useState<string>('30');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const filled = steps.map((s) => s.route.trim()).filter(Boolean);
  const gapNum = Number(gap);
  const canRun = filled.length >= 2 && Number.isFinite(gapNum) && gapNum > 0 && state.kind !== 'loading';

  const update = (id: number, route: string) =>
    setSteps((p) => p.map((s) => (s.id === id ? { ...s, route } : s)));
  const remove = (id: number) => setSteps((p) => p.filter((s) => s.id !== id));
  const add = () => setSteps((p) => [...p, { id: nextId.current++, route: '' }]);
  const move = (i: number, d: -1 | 1) =>
    setSteps((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const n = p.slice();
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const run = async () => {
    setState({ kind: 'loading' });
    try {
      const res = await getNavigationFunnel({ steps: filled, range, surface, gapMinutes: gapNum });
      if (!res.enabled) return setState({ kind: 'disabled' });
      const d = res.data;
      if (!d || !d.steps?.length || !d.steps[0].users) return setState({ kind: 'empty' });
      setState({ kind: 'ready', data: d });
    } catch (e) {
      if (e instanceof AdminUsersRequestError && e.status === 403) return setState({ kind: 'forbidden' });
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Request failed' });
    }
  };

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
      <PageHeader title="Navigation Funnel" subtitle="How many users complete an ordered sequence of screens" />
      <Card title="Steps">
        <ol aria-label="Funnel steps" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {steps.map((s, i) => (
            <li key={s.id} data-testid="funnel-step" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 20, color: colors.muted }}>{i + 1}.</span>
              <Input
                aria-label={`Step ${i + 1} route`}
                list="funnel-routes"
                placeholder="/route"
                value={s.route}
                onChange={(e) => update(s.id, e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <Button sm aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
              <Button sm aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</Button>
              <Button sm aria-label={`Remove step ${i + 1}`} onClick={() => remove(s.id)}>Remove</Button>
            </li>
          ))}
        </ol>
        <div style={{ marginTop: 12 }}>
          <Button onClick={add}>Add step</Button>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '16px 0', alignItems: 'center' }}>
        <div role="group" aria-label="Range" style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} style={chip(range === r)} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
        <div role="group" aria-label="Surface" style={{ display: 'flex', gap: 6 }}>
          {SURFACES.map((s) => (
            <button key={s} type="button" aria-pressed={surface === s} style={chip(surface === s)} onClick={() => setSurface(s)}>{s}</button>
          ))}
        </div>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          Gap minutes
          <Input
            aria-label="Gap minutes"
            type="number"
            min={1}
            value={gap}
            onChange={(e) => setGap(e.target.value)}
            style={{ width: 80 }}
          />
        </label>
        <Button variant="primary" disabled={!canRun} onClick={() => void run()}>Run</Button>
      </div>

      {state.kind === 'loading' && <p style={{ color: colors.muted }}>Running funnel...</p>}
      {state.kind === 'disabled' && <Card><p>Navigation telemetry not enabled</p></Card>}
      {state.kind === 'forbidden' && <Card><p>You do not have permission to view navigation analytics.</p></Card>}
      {state.kind === 'empty' && <Card><p>No funnel data</p></Card>}
      {state.kind === 'error' && (
        <Card>
          <p role="alert" style={{ color: colors.danger }}>{state.message}</p>
          <Button onClick={() => void run()}>Retry</Button>
        </Card>
      )}
      {state.kind === 'ready' && <FunnelBars data={state.data} />}
    </Page>
  );
}

function FunnelBars({ data }: { data: FunnelResult }) {
  const base = data.steps[0].users;
  return (
    <Card title="Funnel">
      <div style={{ display: 'grid', gap: 10 }}>
        {data.steps.map((s, i) => {
          const pct = base ? (s.users / base) * 100 : 0;
          const drop = i > 0 ? dropOff(data.steps[i - 1].users, s.users) : null;
          return (
            <div key={`${i}-${s.route}`} data-testid="funnel-bar">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>{s.route}</span>
                <span>
                  <strong data-testid="funnel-users">{s.users}</strong>
                  {drop !== null && <span style={{ color: colors.muted }}> · <span data-testid="funnel-drop">{drop}%</span> drop-off</span>}
                </span>
              </div>
              <svg width="100%" height="20" role="img" aria-label={`${s.route}: ${s.users} users`}>
                <rect width="100%" height="20" rx="4" fill={colors.border} />
                <rect width={`${pct}%`} height="20" rx="4" fill={colors.primary} />
              </svg>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
