import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, PackagePlus, Layers, FileText, ChevronRight, MapPin, BarChart3 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusinessAccount, useDeliveries, useAnalytics } from '@/features/mobility/hooks/useLogistics';
import { LOGISTICS_ENABLED, DELIVERY_STATUS_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNaira, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { Delivery, DeliveryStatus } from '@/features/mobility/types/logistics.types';

const ACTIVE: DeliveryStatus[] = ['created', 'assigned', 'picked_up'];

function statusTone(s: DeliveryStatus) {
  if (s === 'delivered') return 'success' as const;
  if (s === 'failed' || s === 'cancelled') return 'danger' as const;
  if (s === 'picked_up') return 'info' as const;
  return 'neutral' as const;
}

export default function BusinessDashboardScreen() {
  const account = useBusinessAccount();
  const deliveries = useDeliveries();
  const analytics = useAnalytics();

  if (!LOGISTICS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Business logistics" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  if (account.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Business logistics" /><StateView kind="loading" message="Loading your account…" /></SafeAreaView>
    );
  }
  if (account.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Business logistics" /><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => account.refetch()} /></SafeAreaView>
    );
  }

  const acct = account.data;

  // No account yet → register CTA
  if (!acct) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Business logistics" />
        <MobilityEdgeState
          kind="empty"
          title="Register a business account"
          message="Ship single or bulk deliveries, track couriers, and settle by wallet or monthly invoice."
          actionLabel="Register business account"
          onAction={() => router.push('/mobility/business/register')}
        />
      </SafeAreaView>
    );
  }

  const active = (deliveries.data ?? []).filter((d) => ACTIVE.includes(d.status));
  const refreshing = account.isRefetching || deliveries.isRefetching || analytics.isRefetching;
  const refresh = () => { account.refetch(); deliveries.refetch(); analytics.refetch(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Business logistics"
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/business/invoices')} hitSlop={8} accessibilityLabel="Invoices">
            <FileText size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
      >
        {/* Account summary */}
        <View style={[styles.accountCard, shadow1]}>
          <View style={styles.accountHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName} numberOfLines={1}>{acct.name}</Text>
              <Text style={styles.accountMeta}>
                {acct.billingMode === 'prepaid' ? 'Prepaid wallet' : 'Monthly invoice'} · {acct.codEnabled ? 'COD enabled' : 'COD off'}
              </Text>
            </View>
            <StatusBadge label={acct.accountType} tone="info" />
          </View>
          {acct.billingMode === 'prepaid' && (
            <View style={styles.walletRow}>
              <View style={styles.walletIcon}><Wallet size={20} color={Colors.primary} strokeWidth={2.2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.walletLabel}>Wallet balance</Text>
                <Text style={styles.walletBalance}>{formatNaira(acct.walletBalanceKobo)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Quick actions */}
        <View style={styles.actionsRow}>
          <Action icon={PackagePlus} label="New delivery" onPress={() => router.push('/mobility/business/create')} />
          <Action icon={Layers} label="Bulk batch" onPress={() => router.push('/mobility/business/batch')} />
          <Action icon={MapPin} label="Track" onPress={() => router.push('/mobility/business/tracking')} />
        </View>

        {/* Analytics tiles */}
        <Text style={styles.section}>Performance</Text>
        {analytics.isLoading ? (
          <StateView kind="loading" compact message="Loading analytics…" />
        ) : analytics.data ? (
          <View style={styles.statGrid}>
            <Stat icon={<BarChart3 size={16} color={Colors.primary} strokeWidth={2.2} />} value={String(analytics.data.totalDeliveries)} label="Total deliveries" />
            <Stat value={`${Math.round(analytics.data.successRate * 100)}%`} label="Success rate" />
            <Stat value={formatNairaWhole(analytics.data.codCollectedKobo)} label="COD collected" />
            <Stat value={formatNairaWhole(analytics.data.spendKobo)} label="Total spend" />
          </View>
        ) : null}

        {/* Active deliveries */}
        <View style={styles.activeHead}>
          <Text style={styles.section}>Active deliveries</Text>
          <Pressable onPress={() => router.push('/mobility/business/tracking')} hitSlop={8}>
            <Text style={styles.viewAll}>View all</Text>
          </Pressable>
        </View>
        {deliveries.isLoading ? (
          <StateView kind="loading" compact message="Loading deliveries…" />
        ) : active.length === 0 ? (
          <MobilityEdgeState kind="empty" compact title="No active deliveries" message="Create a delivery to get started." />
        ) : (
          <View style={styles.list}>
            {active.map((d) => (
              <DeliveryRow key={d.id} d={d} onPress={() => router.push(`/mobility/business/delivery/${d.id}`)} />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Create delivery" onPress={() => router.push('/mobility/business/create')} />
      </View>
    </SafeAreaView>
  );
}

function Action({ icon: Icon, label, onPress }: { icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.actionIcon}><Icon size={22} color={Colors.primary} strokeWidth={2} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function Stat({ icon, value, label }: { icon?: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      {icon ? <View style={styles.statIcon}>{icon}</View> : null}
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DeliveryRow({ d, onPress }: { d: Delivery; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{d.receiverName}</Text>
        <Text style={styles.rowAddr} numberOfLines={1}>{d.dropoff.address}</Text>
        <View style={styles.rowMeta}>
          <StatusBadge label={DELIVERY_STATUS_LABEL[d.status]} tone={statusTone(d.status)} />
          <Text style={styles.rowFare}>{formatNairaWhole(d.fareKobo)}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  accountCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  accountHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  accountName: { ...Typography.titleMd, color: Colors.onSurface },
  accountMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  walletIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  walletLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  walletBalance: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: { width: '47.5%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 4 },
  statIcon: { width: 30, height: 30, borderRadius: Radius.sm, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  activeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewAll: { ...Typography.labelMd, color: Colors.secondary },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowAddr: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  rowFare: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
