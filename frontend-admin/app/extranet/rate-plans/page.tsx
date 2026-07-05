'use client';

import { useEffect, useState } from 'react';
import { listRatePlans, listRoomTypes, formatNaira } from '@/services/staysExtranetService';
import type { RatePlan, RoomType } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, th, td, pct } from '../_ui';

export default function RatePlansPage() {
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const [p, r] = await Promise.all([listRatePlans(), listRoomTypes()]); setPlans(p); setRooms(r); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
  const planName = (id: string | null | undefined) => (id ? plans.find((p) => p.id === id)?.name ?? id : '—');

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Rate plans" subtitle="Board basis, refundability, mobile rates and derived/linked rates. Derived plans auto-track a parent plan by a fixed adjustment." action={<><button style={btnPrimary()}>New rate plan</button> <button onClick={load} style={btn()}>Refresh</button></>} />
      <ExtranetTabs active="content" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <Card title={`Rate plans (${plans.length})`}>
        <StateBlock loading={loading} error={error} empty={plans.length === 0} emptyText="No rate plans yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Plan</th><th style={th()}>Room type</th><th style={th()}>Board</th><th style={th()}>Refundable</th><th style={th()}>Mobile</th><th style={th()}>Derived from</th><th style={th()}>Loyalty</th><th style={th()}>Base rate</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.name}</td>
                  <td style={td()}>{roomName(p.room_type_id)}</td>
                  <td style={td()}><Badge status={p.board} /></td>
                  <td style={td()}>{p.refundable ? `Free until ${p.cancellation_window_hours}h` : <Badge status="rejected" label="Non-refundable" />}</td>
                  <td style={td()}>{p.mobile_rate ? <Badge status="mobile" label="Mobile" /> : '—'}</td>
                  <td style={td()}>{p.derived_from ? <span>{planName(p.derived_from)} <Badge status="los" label={`${p.derived_adjustment_pct ? pct(p.derived_adjustment_pct) : ''}`} /></span> : '—'}</td>
                  <td style={td()}>{p.loyalty_opt_in ? <Badge status="enrolled" label="Opted in" /> : '—'}</td>
                  <td style={td()}>{formatNaira(p.base_rate_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{p.currency}</span></td>
                  <td style={td()}><Badge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
