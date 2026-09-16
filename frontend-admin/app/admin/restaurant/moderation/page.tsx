'use client';

/**
 * Listing moderation queue (foodhub A6 / §6.3).
 *
 * Until now a restaurant's public face went live the moment its owner saved it.
 * This is the review step. It is only consequential once
 * FEATURE_FOODHUB_MODERATION is on server-side — with the flag off every listing
 * is served regardless — so the page says so rather than implying decisions here
 * are gating traffic when they may not be.
 */
import { useCallback, useEffect, useState } from 'react';
import { listPendingListings, decideListing, type PendingListing } from '@/services/restaurantAdminService';
import { RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function ListingModerationPage() {
  const { can } = useRestaurantPermissions();
  const allowed = can(RESTAURANT_PERMS.onboarding);

  const [rows, setRows] = useState<PendingListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPendingListings());
    } catch (e) {
      setError((e as Error).message || 'Could not load the moderation queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return <AccessNotice perm="restaurant.admin.onboarding" />;

  const decide = async (id: string, decision: 'approve' | 'reject' | 'changes') => {
    setBusy(id);
    setError(null);
    try {
      await decideListing(id, decision, reasons[id] ?? '');
      // Drop the row locally so the queue visibly shrinks as it is worked; a
      // reload then reconciles with the server.
      setRows((prev) => prev.filter((r) => r.id !== id));
      setReasons((prev) => ({ ...prev, [id]: '' }));
    } catch (e) {
      setError((e as Error).message || 'That decision did not go through.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Listing moderation"
        subtitle="Restaurants awaiting review before their listing can be shown to customers."
      />

      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: colors.muted }}>
          Decisions here take effect only while <strong>FEATURE_FOODHUB_MODERATION</strong> is enabled on the
          backend. With it off, every open restaurant is served to customers regardless of this queue.
        </div>
      </Card>

      {error && (
        <Card style={{ padding: 14, marginBottom: 16, borderColor: colors.danger }}>
          <div style={{ color: colors.danger, fontSize: 13 }}>{error}</div>
        </Card>
      )}

      <Card>
        {loading ? (
          <div style={{ padding: 20, color: colors.muted }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20, color: colors.muted }}>
            Nothing awaiting review. New restaurants appear here when their owner submits a listing.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Restaurant</th>
                <th style={thCell}>Address</th>
                <th style={thCell}>Trading</th>
                <th style={thCell}>Reason (required to reject or request changes)</th>
                <th style={thCell}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>{r.name}</td>
                  <td style={tdCell}>{r.address}</td>
                  <td style={tdCell}>
                    <Badge text={r.is_open ? 'Open' : 'Closed'} color={r.is_open ? colors.success : colors.secondary} />
                  </td>
                  <td style={tdCell}>
                    <input
                      value={reasons[r.id] ?? ''}
                      onChange={(e) => setReasons((p) => ({ ...p, [r.id]: e.target.value }))}
                      placeholder="What must the owner change?"
                      style={{ width: '100%', padding: 6, borderRadius: 6, border: `1px solid ${colors.border}` }}
                    />
                  </td>
                  <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>
                    <Button onClick={() => decide(r.id, 'approve')} disabled={busy === r.id}>Approve</Button>{' '}
                    <Button onClick={() => decide(r.id, 'changes')} disabled={busy === r.id}>Request changes</Button>{' '}
                    <Button onClick={() => decide(r.id, 'reject')} disabled={busy === r.id}>Reject</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
