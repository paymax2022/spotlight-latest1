'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getOrderTrace, type TraceEvent } from '@/services/restaurantAdminService';
import { useRestaurantPermissions, AccessNotice } from '../../../_ui';
import { Page, PageHeader, Card, Button, colors, tint } from '@/components/ui/vuexy';

// FOOD-UAT-G-006: chronological order event history. Read-only; the server
// (restaurant.admin.trace) is authoritative. Transitions the compare-and-set
// guard REFUSED are not persisted, so they cannot appear here.

const KIND_COLOR: Record<string, string> = {
  order: colors.primary,
  transition: colors.info,
  dispatch: colors.warning,
  payment: colors.success,
  dispute: colors.danger,
  payout: colors.secondary,
  code_lockout: colors.danger,
  audit: colors.muted,
};

const fmt = (v: unknown) => (v == null ? '' : JSON.stringify(v));

function csvCell(v: string): string {
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

function traceToCsv(events: TraceEvent[]): string {
  const head = ['at', 'kind', 'actor_user_id', 'note', 'before', 'after', 'correlation_id', 'id'];
  const rows = events.map((e) =>
    [e.at, e.kind, e.actor_user_id ?? '', e.note, fmt(e.before), fmt(e.after), e.correlation_id, e.id].map(csvCell).join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

export default function OrderTracePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { can } = useRestaurantPermissions();
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setEvents((await getOrderTrace(id)).events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trace');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([traceToCsv(events)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `order-${id}-trace.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page>
      <PageHeader
        title="Order trace"
        subtitle={id ? `Order ${id}` : undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => router.back()}>← Back</Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>Refresh</Button>
            <Button variant="primary" onClick={exportCsv} disabled={events.length === 0}>Export CSV</Button>
          </>
        }
      />
      {!can(['restaurant.admin.trace']) && <AccessNotice perm="restaurant.admin.trace" />}
      {error && <Card style={{ marginBottom: 16, borderColor: colors.danger, color: colors.danger }}>{error}</Card>}
      {loading ? (
        <Card><div style={{ color: colors.muted }}>Loading…</div></Card>
      ) : events.length === 0 && !error ? (
        <Card><div style={{ color: colors.muted }}>No events recorded.</div></Card>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {events.map((e) => {
            const c = KIND_COLOR[e.kind] ?? colors.muted;
            return (
              <li key={e.id} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                <div style={{ width: 4, borderRadius: 2, background: c, flexShrink: 0 }} />
                <Card style={{ flex: 1, padding: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ background: tint(c, 0.12), color: c, borderRadius: 4, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>{e.kind}</span>
                    <strong style={{ fontSize: 13 }}>{e.note}</strong>
                    <span style={{ marginLeft: 'auto', color: colors.muted, fontSize: 12 }}>{new Date(e.at).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
                    actor: <code>{e.actor_user_id ?? 'system'}</code> · correlation: <code>{e.correlation_id}</code>
                  </div>
                  {(e.before != null || e.after != null) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, fontSize: 12 }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: colors.bg, padding: 6, borderRadius: 4 }}>before: {fmt(e.before) || '—'}</pre>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: colors.bg, padding: 6, borderRadius: 4 }}>after: {fmt(e.after) || '—'}</pre>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </Page>
  );
}
