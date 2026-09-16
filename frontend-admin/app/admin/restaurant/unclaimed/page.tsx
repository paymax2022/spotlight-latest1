'use client';

/**
 * Unclaimed restaurants (foodhub §5.4).
 *
 * A shop with no identifiable merchant behind it: no owner, or an owner with no
 * active merchant profile. Such a restaurant can appear in discovery and take
 * orders while nobody can manage it and no payout has a destination.
 *
 * Expected to be EMPTY — the legacy-linking migration resolved all 1539 owners.
 * It exists so that an imported or admin-seeded row cannot sit unmanaged and
 * unnoticed, which is exactly how the previous 1539 went unnoticed.
 */
import { useCallback, useEffect, useState } from 'react';
import { listUnclaimedRestaurants, type UnclaimedRestaurant } from '@/services/restaurantAdminService';
import { RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function UnclaimedRestaurantsPage() {
  const { can } = useRestaurantPermissions();
  const allowed = can(RESTAURANT_PERMS.onboarding);

  const [rows, setRows] = useState<UnclaimedRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listUnclaimedRestaurants());
    } catch (e) {
      setError((e as Error).message || 'Could not load unclaimed restaurants.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return <AccessNotice perm="restaurant.admin.onboarding" />;

  return (
    <Page>
      <PageHeader
        title="Unclaimed restaurants"
        subtitle="Shops with no merchant behind them — they can trade, but nobody can manage them and payouts have no destination."
      />

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
            None — every restaurant has an owner with an active merchant profile. Rows appear here if a shop is
            imported or created without one.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Restaurant</th>
                <th style={thCell}>Address</th>
                <th style={thCell}>Trading</th>
                <th style={thCell}>Why it is unclaimed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>{r.name}</td>
                  <td style={tdCell}>{r.address}</td>
                  <td style={tdCell}>
                    {/* Trading while unmanaged is the urgent case, so it is called out. */}
                    <Badge
                      text={r.is_open ? 'Open — taking orders' : 'Closed'}
                      color={r.is_open ? colors.danger : colors.secondary}
                    />
                  </td>
                  <td style={tdCell}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
