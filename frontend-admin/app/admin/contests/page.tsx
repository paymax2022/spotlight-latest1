'use client';

/**
 * Contests — the first console reached over PATH A (admin consolidation slice 3).
 *
 * Its data has no Go module; it lives in frontend-web and arrives via
 * /api/web-proxy. Written as a client component calling a service, matching every
 * other console here — the frontend-web original is a SERVER component reading
 * `@/src/server/*` directly, which is exactly what could not be carried across.
 *
 * MANAGEMENT. Edit opens the full contest editor at /admin/competitions/create,
 * which is the single place a contest is authored — it owns the category/type
 * matrix, the entry rules, the stage list and the publish control, and it loads
 * an existing record from `?id=<slug>`. Duplicating those fields here would give
 * the platform two editors to keep in step, so this page links to that one and
 * keeps only the destructive action, which needs no form.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listAdminContests, deleteFullContest, type AdminContest } from '@/services/contestsAdminService';
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

function editHref(slug: string): string {
  return `/admin/competitions/create?id=${encodeURIComponent(slug)}`;
}

export default function ContestsAdminPage() {
  const [items, setItems] = useState<AdminContest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kept separate from `error`: a failed delete must not blank the table the
  // admin is still working in.
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

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

  const remove = useCallback(async (contest: AdminContest) => {
    const label = contest.name || contest.slug;
    if (!window.confirm(`Delete "${label}"? This removes the contest record and cannot be undone.`)) return;

    setDeletingSlug(contest.slug);
    setActionError(null);
    try {
      await deleteFullContest(contest.slug);
      // The server confirmed the delete, so drop the row rather than refetching
      // the whole list — the admin sees the result immediately.
      setItems((prev) => prev.filter((c) => c.id !== contest.id));
    } catch (e) {
      setActionError(`Could not delete "${label}": ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingSlug(null);
    }
  }, []);

  return (
    <Page>
      <PageHeader
        title="Contest Records"
        subtitle="The admin-authored record for every contest — category, type, dates — regardless of whether it supports voting."
        actions={
          <Link href="/admin/competitions/create">
            <Button variant="primary">+ New contest</Button>
          </Link>
        }
      />

      <Card>
        <p style={{ color: colors.muted, fontSize: 13, margin: '0 0 16px' }}>
          This is the source record admins create and edit; it always contains every contest the
          platform tracks, including ones with no voting (auditions, pitch competitions). Every
          row here mirrors automatically into the mobile voting app the moment it&apos;s created or
          updated — for live stage progress, contestant counts and vote totals, see{' '}
          <Link href="/admin/competitions/list" style={{ color: colors.primary }}>Competitions</Link>.
          Status labels differ between the two: this page shows draft/active/upcoming/ended, while
          Competitions collapses &quot;upcoming&quot; into &quot;draft&quot; to match what the mobile app can render —
          the same contest can legitimately show a different-looking status on each page.
        </p>

        {loading && <p style={{ color: colors.muted }}>Loading contests…</p>}

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <p style={{ color: colors.danger, margin: 0 }}>{error}</p>
            <Button onClick={load}>Retry</Button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              margin: '0 0 16px', padding: '10px 12px', borderRadius: 6,
              border: `1px solid ${colors.danger}`, color: colors.danger, fontSize: 13,
            }}
          >
            <span>{actionError}</span>
            <Button sm onClick={() => setActionError(null)}>Dismiss</Button>
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
                  {['Contest', 'Type', 'Status', 'Starts', 'Ends', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: colors.muted, fontWeight: 600, fontSize: 13 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const busy = deletingSlug === c.slug;
                  return (
                    <tr key={c.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '12px' }}>{c.name}</td>
                      <td style={{ padding: '12px', color: colors.muted }}>{c.contest_type}</td>
                      <td style={{ padding: '12px' }}>
                        <Badge text={c.status} color={STATUS_BADGE[c.status] ?? colors.muted} />
                      </td>
                      <td style={{ padding: '12px', color: colors.muted }}>{when(c.start_date)}</td>
                      <td style={{ padding: '12px', color: colors.muted }}>{when(c.end_date)}</td>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Link href={editHref(c.slug)}>
                            <Button sm aria-label={`Edit ${c.name}`}>Edit</Button>
                          </Link>
                          <Button
                            sm
                            variant="danger"
                            disabled={busy}
                            aria-label={`Delete ${c.name}`}
                            onClick={() => remove(c)}
                          >
                            {busy ? 'Deleting…' : 'Delete'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
