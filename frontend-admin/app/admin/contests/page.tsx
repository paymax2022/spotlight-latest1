'use client';

/**
 * Contests — the first console reached over PATH A (admin consolidation slice 3).
 *
 * Its data has no Go module; it lives in frontend-web and arrives via
 * /api/web-proxy. Written as a client component calling a service, matching every
 * other console here — the frontend-web original is a SERVER component reading
 * `@/src/server/*` directly, which is exactly what could not be carried across.
 */
import { useCallback, useEffect, useState } from 'react';
import { listAdminContests, type AdminContest } from '@/services/contestsAdminService';
import { Page, PageHeader, Card, Button, Badge, colors } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  active: colors.success,
  upcoming: colors.info,
  ended: colors.muted,
  draft: colors.warning,
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export default function ContestsAdminPage() {
  const [items, setItems] = useState<AdminContest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listAdminContests());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Page>
      <PageHeader
        title="Contests"
        subtitle="Every contest on the platform. Served from the web app over the admin web proxy."
      />

      <Card>
        {loading && <p style={{ color: colors.muted }}>Loading contests…</p>}

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <p style={{ color: colors.danger, margin: 0 }}>{error}</p>
            <Button onClick={load}>Retry</Button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <p style={{ color: colors.muted, margin: 0 }}>No contests yet.</p>
        )}

        {!loading && !error && items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Contest', 'Type', 'Status', 'Starts', 'Ends'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: colors.muted, fontWeight: 600, fontSize: 13 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '12px' }}>{c.name}</td>
                    <td style={{ padding: '12px', color: colors.muted }}>{c.contest_type}</td>
                    <td style={{ padding: '12px' }}>
                      <Badge text={c.status} color={STATUS_BADGE[c.status] ?? colors.muted} />
                    </td>
                    <td style={{ padding: '12px', color: colors.muted }}>{when(c.start_date)}</td>
                    <td style={{ padding: '12px', color: colors.muted }}>{when(c.end_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
