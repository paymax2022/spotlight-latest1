'use client';

/**
 * Open Mic — contest list, the entry point for the third Path A console
 * (admin consolidation slice 4; see docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listOpenMicContests, type OpenMicContest } from '@/services/openMicAdminService';
import { Page, PageHeader, Card, Button, Badge, colors } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  published: colors.success,
  registration_open: colors.info,
  submission_open: colors.info,
  voting_live: colors.primary,
  draft: colors.muted,
  archived: colors.muted,
};

export default function OpenMicAdminPage() {
  const [items, setItems] = useState<OpenMicContest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listOpenMicContests());
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
        title="Open Mic"
        subtitle="Monthly contest editions. Served from the web app over the admin web proxy."
        actions={(
          <Link href="/admin/open-mic/new" style={{ textDecoration: 'none' }}>
            <Button variant="primary">New Contest</Button>
          </Link>
        )}
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
          <p style={{ color: colors.muted, margin: 0 }}>No Open Mic contests yet.</p>
        )}

        {!loading && !error && items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Contest', 'Edition', 'Status', 'Vote Price', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: colors.muted, fontWeight: 600, fontSize: 13 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '12px', fontWeight: 600 }}>{c.title}</td>
                    <td style={{ padding: '12px', color: colors.muted }}>{c.month}/{c.year} · {c.season}</td>
                    <td style={{ padding: '12px' }}>
                      <Badge text={c.status.replace(/_/g, ' ')} color={STATUS_BADGE[c.status] ?? colors.muted} />
                    </td>
                    <td style={{ padding: '12px', color: colors.muted }}>₦{c.votingConfig?.votePrice ?? 0}</td>
                    <td style={{ padding: '12px' }}>
                      <Link href={`/admin/open-mic/${c.id}`} style={{ textDecoration: 'none' }}>
                        <Button variant="outline">Manage</Button>
                      </Link>
                    </td>
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
