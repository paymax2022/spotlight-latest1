// ── Paymax · Admin Console — User detail ─────────────────────────────────────
// Full profile drill-down: identity, KYC, balances, risk flags + a link to the
// user's KYC case.

import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { AdminHeader, ListCard, DataRow, StatusPill } from '@/features/admin/components';
import { useAdminUser } from '@/features/admin/hooks/useAdmin';
import {
  ENTITY_STATUS_STYLE,
  KYC_STATUS_STYLE,
  formatMoneyObj,
  formatDateTime,
  relativeTime,
} from '@/features/admin/constants/admin.constants';

export default function AdminUserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAdminUser(id);
  const u = user.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="User" subtitle={u?.name} />

      {user.isLoading ? (
        <StateView kind="loading" message="Loading profile…" />
      ) : user.isError ? (
        <StateView
          kind="error"
          title="Couldn't load this user"
          message={(user.error as Error)?.message ?? 'Please try again.'}
          actionLabel="Retry"
          onAction={() => user.refetch()}
        />
      ) : !u ? (
        <StateView kind="empty" icon="UserX" title="User not found" message="This account no longer exists." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={user.isRefetching} onRefresh={() => user.refetch()} tintColor={Colors.primary} />
          }
        >
          {/* Identity header */}
          <View style={styles.hero}>
            <Text style={styles.heroName}>{u.name}</Text>
            <Text style={styles.heroEmail}>{u.email}</Text>
            <View style={styles.heroPills}>
              <StatusPill status={u.status} styleMap={ENTITY_STATUS_STYLE} />
              <StatusPill status={u.kycStatus} styleMap={KYC_STATUS_STYLE} />
            </View>
          </View>

          <ListCard title="Profile" flush>
            <DataRow label="User ID" value={u.id} />
            <DataRow label="Phone" value={u.phone} />
            <DataRow label="Country" value={u.country} />
            <DataRow label="Joined" value={formatDateTime(u.createdAt)} />
            <DataRow label="Last active" value={relativeTime(u.lastActiveAt)} last />
          </ListCard>

          <ListCard title="Verification & balances" flush>
            <DataRow label="KYC tier" value={`Tier ${u.kycTier}`} />
            <DataRow
              label="KYC status"
              right={<StatusPill status={u.kycStatus} styleMap={KYC_STATUS_STYLE} />}
            />
            <DataRow label="Wallet balance" value={formatMoneyObj(u.walletBalance)} />
            <DataRow label="Lifetime volume" value={formatMoneyObj(u.lifetimeVolume)} last />
          </ListCard>

          {u.flags.length > 0 ? (
            <ListCard title="Risk & ops flags" flush>
              {u.flags.map((f, i, arr) => (
                <DataRow key={f} label={f} right={<StatusPill chip={{ label: 'Flag', fg: Colors.error, bg: Colors.iconBgRed }} />} last={i === arr.length - 1} />
              ))}
            </ListCard>
          ) : null}

          <ListCard title="Related" flush>
            <DataRow
              label="KYC case"
              sublabel="Review identity verification"
              onPress={() => router.push(`/admin/kyc/${u.id}`)}
              showChevron
              last
            />
          </ListCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: {
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.xs,
    padding: Spacing.cardPadding,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    gap: Spacing.xs,
  },
  heroName: { ...Typography.titleLg, color: Colors.onSurface },
  heroEmail: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  heroPills: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
});
