// ── Listing insights — seller performance for one listing ────────────────────
//
// Entry: the "Insights" quick action on a My Listings card.
//
// Every figure comes from GET /listings/:id/insights, which counts the event
// tables (saves, threads, offers, contact reveals, orders) rather than the
// denormalised counters on mkt_listings — save_count has no writer, so reading it
// would report zero saves forever.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Eye, Heart, MessageSquare, Tag, Phone, ShoppingBag, Zap, TrendingUp } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira } from '@/features/marketplace';
import { useListingInsights } from '@/features/marketplace/sell.hooks';

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function ListingInsightsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useListingInsights(id ?? null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/marketplace/sell')} style={styles.backBtn} accessibilityLabel="Go back">
          <ArrowLeft size={20} color={MarketColors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Performance</Text>
        <View style={styles.backBtn} />
      </View>

      {q.isLoading ? (
        <View style={styles.pad}><StateView kind="loading" message="Loading performance…" /></View>
      ) : q.isError || !q.data ? (
        <View style={styles.pad}>
          <StateView
            kind="error"
            title="Couldn't load performance"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => q.refetch()}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.pad}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={MarketColors.brand} />}
        >
          <View style={[styles.hero, shadow1]}>
            <View style={styles.heroIcon}><Eye size={22} color={MarketColors.brand} /></View>
            <Text style={styles.heroValue}>{q.data.views.toLocaleString()}</Text>
            <Text style={styles.heroLabel}>views since {fmtDate(q.data.listedAt)}</Text>
          </View>

          <Text style={styles.sectionTitle}>Buyer interest</Text>
          <View style={styles.grid}>
            <Metric icon={Heart} label="Saves" value={q.data.saves} />
            <Metric icon={MessageSquare} label="Enquiries" value={q.data.enquiries} />
            <Metric icon={Tag} label="Offers" value={q.data.offers} />
            <Metric icon={Phone} label="Contact reveals" value={q.data.contactReveals} />
            <Metric icon={ShoppingBag} label="Orders" value={q.data.orders} />
          </View>

          {q.data.bestOfferKobo != null && (
            <View style={[styles.row, shadow1]}>
              <View style={[styles.rowIcon, { backgroundColor: MarketColors.okBg }]}>
                <TrendingUp size={18} color={MarketColors.ok} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Best standing offer</Text>
                <Text style={styles.rowSub}>Highest offer still open</Text>
              </View>
              <Text style={styles.rowValue}>{formatNaira(q.data.bestOfferKobo)}</Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Promotion</Text>
          {q.data.boostActive ? (
            <View style={[styles.row, shadow1]}>
              <View style={[styles.rowIcon, { backgroundColor: MarketColors.okBg }]}>
                <Zap size={18} color={MarketColors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Boost active{q.data.boostTier ? ` · ${q.data.boostTier}` : ''}</Text>
                <Text style={styles.rowSub}>Top of results until {fmtDate(q.data.boostEndsAt)}</Text>
              </View>
            </View>
          ) : (
            <Pressable
              style={[styles.row, styles.rowCta, shadow1]}
              onPress={() => router.push(`/marketplace/boost/${id}` as never)}
              accessibilityRole="button"
              accessibilityLabel="Boost this listing"
            >
              <View style={[styles.rowIcon, { backgroundColor: MarketColors.okBg }]}>
                <Zap size={18} color={MarketColors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Boost this listing</Text>
                <Text style={styles.rowSub}>Put it at the top of results for a set number of days</Text>
              </View>
            </Pressable>
          )}

          <Text style={styles.footnote}>
            Listed {fmtDate(q.data.listedAt)}
            {q.data.expiresAt ? ` · expires ${fmtDate(q.data.expiresAt)}` : ''}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <View style={[styles.tile, shadow1]}>
      <Icon size={16} color={MarketColors.muted} />
      <Text style={styles.tileValue}>{value.toLocaleString()}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.titleLg, color: MarketColors.text },
  pad: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  hero: { alignItems: 'center', gap: 4, padding: Spacing.lg, borderRadius: Radius.lg, backgroundColor: MarketColors.surface, borderWidth: 1, borderColor: MarketColors.border },
  heroIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: MarketColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroValue: { ...Typography.headlineMd, color: MarketColors.text },
  heroLabel: { ...Typography.labelSm, color: MarketColors.muted },
  sectionTitle: { ...Typography.titleMd, color: MarketColors.text, marginTop: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 96, gap: 2, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: MarketColors.surface, borderWidth: 1, borderColor: MarketColors.border },
  tileValue: { ...Typography.titleLg, color: MarketColors.text },
  tileLabel: { ...Typography.labelSm, color: MarketColors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: MarketColors.surface, borderWidth: 1, borderColor: MarketColors.border },
  rowCta: { borderColor: MarketColors.brand },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelLg, color: MarketColors.text },
  rowSub: { ...Typography.caption, color: MarketColors.muted },
  rowValue: { ...Typography.titleMd, color: MarketColors.brand },
  footnote: { ...Typography.caption, color: MarketColors.muted, textAlign: 'center', marginTop: Spacing.md },
});
