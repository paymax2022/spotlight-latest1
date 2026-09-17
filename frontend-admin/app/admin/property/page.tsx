'use client';

import { useEffect, useState } from 'react';
import { getOwnContext, getRentPassportLookup } from '@/services/propertyAdminService';
import type { PropertyContextResponse, RentPassport } from '@/types/propertyAdmin';
import { PageHeader, Card, Kpi, Badge, btn, input, th, td, money, timeAgo } from './_ui';

// Property Management — rent-passport screening lookup + own-context diagnostic.
// Access is gated at the console level: the sidebar entry and routeGuard.ts both
// require `property.manage` (see src/features/auth/routeGuard.ts and
// src/components/layouts/AdminSidebar.tsx), matching how every other RBAC-gated
// module in this console works — an operator without the permission never sees
// this route rendered, and the Go backend independently enforces the same
// permission on the lookup endpoint (fail-closed IDOR guard, see
// docs/qa/modules/property.md §6).

export default function PropertyPage() {
  // ── Rent passport screening lookup (P0) ──────────────────────────────────
  const [userId, setUserId] = useState('');
  const [passport, setPassport] = useState<RentPassport | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  async function runLookup() {
    const id = userId.trim();
    if (!id) return;
    setLookupLoading(true);
    setLookupError(null);
    setPassport(null);
    try {
      setPassport(await getRentPassportLookup(id));
    } catch (e) {
      setLookupError(String(e));
    } finally {
      setLookupLoading(false);
    }
  }

  // ── Own-context diagnostic (P1) ──────────────────────────────────────────
  const [context, setContext] = useState<PropertyContextResponse | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);

  async function loadContext() {
    setContextLoading(true);
    setContextError(null);
    try {
      setContext(await getOwnContext());
    } catch (e) {
      setContextError(String(e));
    } finally {
      setContextLoading(false);
    }
  }
  useEffect(() => { loadContext(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Property Management"
        subtitle="Rent-passport tenant screening and the property role-context diagnostic (estate ↔ realtor unification suite)."
      />

      <Card title="Rent passport screening lookup">
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 0 }}>
          Look up a prospective tenant or lessee&apos;s portable payment-history trust profile by user ID.
          Requires the <code>property.manage</code> permission — the backend enforces this independently
          of this page.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            style={input()}
            placeholder="User ID (UUID)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runLookup(); }}
          />
          <button style={btn()} onClick={runLookup} disabled={lookupLoading || !userId.trim()}>
            {lookupLoading ? 'Looking up…' : 'Look up'}
          </button>
        </div>

        {lookupError && (
          <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>
            {lookupError.includes('403')
              ? 'Not authorized — this admin session lacks property.manage.'
              : lookupError}
          </p>
        )}

        {passport && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              <Kpi label="Score" value={String(passport.score)} accent={passport.score >= 70 ? '#16a34a' : passport.score >= 40 ? '#d97706' : '#dc2626'} sub="0-100" />
              <Kpi label="On-time ratio" value={`${Math.round(passport.onTimeRate * 100)}%`} />
              <Kpi label="Lifetime paid" value={money(passport.totalPaidKobo)} accent="#1d4ed8" />
              <Kpi label="Payments" value={String(passport.paymentsCount)} />
              <Kpi label="Oldest tenancy" value={passport.oldestTenancy ? timeAgo(passport.oldestTenancy) : '—'} />
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Source</th>
                  <th style={th()}>Category</th>
                  <th style={th()}>Amount</th>
                  <th style={th()}>On time</th>
                  <th style={th()}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {passport.recentPayments.length === 0 ? (
                  <tr><td style={td()} colSpan={5}>No payment history.</td></tr>
                ) : (
                  passport.recentPayments.map((p, i) => (
                    <tr key={i}>
                      <td style={td()}>{p.source}</td>
                      <td style={td()}>{p.category}</td>
                      <td style={td()}>{money(p.amountKobo)}</td>
                      <td style={td()}><Badge status={String(p.onTime)} label={p.onTime ? 'On time' : 'Late'} /></td>
                      <td style={td()}>{timeAgo(p.paidAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="My role context (diagnostic)" right={<button style={btn()} onClick={loadContext}>Refresh</button>}>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 0 }}>
          The signed-in admin&apos;s own aggregated property roles — useful to confirm the flag and route are
          wired end to end.
        </p>
        {contextError && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{contextError}</p>}
        {contextLoading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem' }}>
              Active context: {context?.activeContext ? `${context.activeContext.type} · ${context.activeContext.id}` : 'none'}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Type</th>
                  <th style={th()}>Name</th>
                  <th style={th()}>ID</th>
                  <th style={th()}>Roles</th>
                </tr>
              </thead>
              <tbody>
                {!context || context.contexts.length === 0 ? (
                  <tr><td style={td()} colSpan={4}>No property roles for this account.</td></tr>
                ) : (
                  context.contexts.map((c) => (
                    <tr key={`${c.type}:${c.id}`}>
                      <td style={td()}>{c.type}</td>
                      <td style={td()}>{c.name || '—'}</td>
                      <td style={td()}><code>{c.id}</code></td>
                      <td style={td()}>{c.roles.join(', ')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
