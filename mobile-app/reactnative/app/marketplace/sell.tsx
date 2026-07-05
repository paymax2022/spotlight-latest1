// ── Sell tab — My Listings dashboard (15) OR Sell entry CTA (10) ─────────────
// If the seller has listings → the My Listings command center (status chips,
// per-listing stats, quick actions: renew / pause·resume / mark sold / boost).
// If not → the zero-friction Sell entry CTA into the camera-first composer.
// States: skeletons (not spinners) on cold load; empty → Sell entry.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Camera, Plus, Eye, Heart, Zap, Play, Pause, RefreshCw, CheckCircle2, Tag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira, conditionLabel } from '@/features/marketplace';
import type { Listing, ListingStatus } from '@/features/marketplace';
import {
  useMyListings,
  usePauseListing,
  useResumeListing,
  useRenewListing,
  useMarkSold,
} from '@/features/marketplace/sell.hooks';

const STATUS_META: Record<ListingStatus, { label: string; color: keyof typeof MarketColors; bg: keyof typeof MarketColors }> = {
  active: { label: 'Live', color: 'ok', bg: 'okBg' },
  pending_review: { label: 'Pending review', color: 'warnText', bg: 'warnBg' },
  paused: { label: 'Paused', color: 'muted', bg: 'surfaceAlt' },
  sold: { label: 'Sold', color: 'brand', bg: 'okBg' },
  expired: { label: 'Expired', color: 'danger', bg: 'dangerBg' },
  draft: { label: 'Draft', color: 'muted', bg: 'surfaceAlt' },
  removed_policy: { label: 'Removed', color: 'danger', bg: 'dangerBg' },
  removed_user: { label: 'Removed', color: 'muted', bg: 'surfaceAlt' },
};

export default function SellTab() {
  const listingsQuery = useMyListings();
  const listings = listingsQuery.data ?? [];

  // Cold load → skeletons (offline-first convention, never a spinner on content).
  if (listingsQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>My listings</Text>
        </View>
        <View style={styles.listPad}>
          {[0, 1, 2].map((i) => <ListingSkeleton key={i} />)}
        </View>
      </SafeAreaView>
    );
  }

  if (listingsQuery.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="error" title="Couldn't load your listings" message="Check your connection and try again." actionLabel="Retry" onAction={() => listingsQuery.refetch()} />
      </SafeAreaView>
    );
  }

  if (listings.length === 0) return <SellEntry />;

  return <MyListings listings={listings} refreshing={listingsQuery.isRefetching} onRefresh={() => listingsQuery.refetch()} />;
}

// ── Screen 10 entry — empty state → camera composer ──
function SellEntry() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.entryWrap}>
        <View style={styles.entryIcon}><Camera size={36} color={MarketColors.brand} /></View>
        <Text style={styles.entryTitle}>Sell on Paymax</Text>
        <Text style={styles.entryBody}>List an item in minutes — snap a few photos and our composer does the rest. Escrow-ready by default, so buyers trust you faster.</Text>
        <View style={styles.entryCta}>
          <PrimaryButton label="Start a listing" onPress={() => router.push('/marketplace/sell/compose' as never)} />
        </View>
        <View style={styles.entryPoints}>
          <EntryPoint icon={CheckCircle2} text="Auto-approved categories go live in under 5 minutes" />
          <EntryPoint icon={CheckCircle2} text="Buyer-protection escrow built in" />
          <EntryPoint icon={CheckCircle2} text="Fair-price guidance so you price to sell" />
        </View>
      </View>
    </SafeAreaView>
  );
}

function EntryPoint({ icon: Icon, text }: { icon: React.ComponentType<{ size?: number; color?: string }>; text: string }) {
  return (
    <View style={styles.entryPointRow}>
      <Icon size={16} color={MarketColors.ok} />
      <Text style={styles.entryPointText}>{text}</Text>
    </View>
  );
}

// ── Screen 15 — My Listings dashboard ──
function MyListings({ listings, refreshing, onRefresh }: { listings: Listing[]; refreshing: boolean; onRefresh: () => void }) {
  const [filter, setFilter] = useState<'all' | ListingStatus>('all');
  const filtered = filter === 'all' ? listings : listings.filter((l) => l.status === filter);
  const statusesPresent = Array.from(new Set(listings.map((l) => l.status)));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.pageTitle}>My listings</Text>
        <Pressable style={styles.newBtn} onPress={() => router.push('/marketplace/sell/compose' as never)} accessibilityLabel="New listing">
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.newBtnText}>New</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        {statusesPresent.map((s) => (
          <FilterChip key={s} label={STATUS_META[s].label} active={filter === s} onPress={() => setFilter(s)} />
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.listPad}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MarketColors.brand} />}
      >
        {filtered.length === 0 ? (
          <StateView kind="empty" title="Nothing here" message="No listings with this status." compact />
        ) : (
          filtered.map((l) => <ListingRow key={l.id} listing={l} />)
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ListingRow({ listing }: { listing: Listing }) {
  const pause = usePauseListing();
  const resume = useResumeListing();
  const renew = useRenewListing();
  const markSold = useMarkSold();
  const meta = STATUS_META[listing.status];
  const cover = listing.media?.[0];
  const busy = pause.isPending || resume.isPending || renew.isPending || markSold.isPending;

  const confirmMarkSold = () => {
    Alert.alert('Mark as sold', 'How did you sell this item?', [
      { text: 'Via Paymax escrow', onPress: () => markSold.mutate({ id: listing.id, viaEscrow: true }) },
      { text: 'Sold elsewhere', onPress: () => markSold.mutate({ id: listing.id, viaEscrow: false }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.card}>
      <Pressable style={styles.cardTop} onPress={() => router.push(`/marketplace/listing/${listing.id}` as never)}>
        {cover?.urlThumb ? <Image source={{ uri: cover.urlThumb }} style={styles.cardThumb} /> : <View style={[styles.cardThumb, styles.cardThumbEmpty]}><Tag size={20} color={MarketColors.muted} /></View>}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{listing.title}</Text>
          <Text style={styles.cardPrice}>{formatNaira(listing.priceKobo)}</Text>
          <View style={styles.cardMetaRow}>
            <View style={[styles.statusChip, { backgroundColor: MarketColors[meta.bg] }]}>
              <Text style={[styles.statusChipText, { color: MarketColors[meta.color] }]}>{meta.label}</Text>
            </View>
            <Text style={styles.cardCondition}>{conditionLabel(listing.condition)}</Text>
          </View>
        </View>
      </Pressable>

      <View style={styles.statsRow}>
        <Stat icon={Eye} value={listing.viewCount} label="views" />
        <Stat icon={Heart} value={listing.saveCount} label="saves" />
      </View>

      <View style={styles.actionsRow}>
        {listing.status === 'active' ? (
          <QuickAction icon={Pause} label="Pause" onPress={() => pause.mutate(listing.id)} disabled={busy} />
        ) : listing.status === 'paused' ? (
          <QuickAction icon={Play} label="Resume" onPress={() => resume.mutate(listing.id)} disabled={busy} />
        ) : null}
        {listing.status === 'expired' ? (
          <QuickAction icon={RefreshCw} label="Renew" onPress={() => renew.mutate(listing.id)} disabled={busy} />
        ) : null}
        {listing.status !== 'sold' ? (
          <QuickAction icon={CheckCircle2} label="Mark sold" onPress={confirmMarkSold} disabled={busy} />
        ) : null}
        {(listing.status === 'active' || listing.status === 'paused') ? (
          <QuickAction icon={Zap} label="Boost" onPress={() => router.push(`/marketplace/boost/${listing.id}` as never)} disabled={busy} highlight />
        ) : null}
      </View>
    </View>
  );
}

function Stat({ icon: Icon, value, label }: { icon: React.ComponentType<{ size?: number; color?: string }>; value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Icon size={14} color={MarketColors.muted} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon: Icon, label, onPress, disabled, highlight }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; onPress: () => void; disabled?: boolean; highlight?: boolean }) {
  return (
    <Pressable style={[styles.action, highlight && styles.actionHighlight, disabled && styles.actionDisabled]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Icon size={15} color={highlight ? MarketColors.brand : MarketColors.text} />
      <Text style={[styles.actionText, highlight && styles.actionTextHighlight]}>{label}</Text>
    </Pressable>
  );
}

function ListingSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.cardThumb, styles.skel]} />
        <View style={styles.cardBody}>
          <View style={[styles.skelBar, { width: '70%' }]} />
          <View style={[styles.skelBar, { width: '40%', marginTop: 8 }]} />
          <View style={[styles.skelBar, { width: '30%', marginTop: 8 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  pageTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: MarketColors.brand, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  newBtnText: { ...Typography.labelMd, color: '#FFFFFF', fontWeight: '700' },
  filterRow: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.xs, paddingBottom: Spacing.sm },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  filterChipActive: { borderColor: MarketColors.brand, backgroundColor: MarketColors.okBg },
  filterChipText: { ...Typography.labelMd, color: MarketColors.muted },
  filterChipTextActive: { color: MarketColors.brand, fontWeight: '700' },
  listPad: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  card: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, padding: Spacing.md, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', gap: Spacing.sm },
  cardThumb: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt },
  cardThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...Typography.titleMd, color: MarketColors.text },
  cardPrice: { ...Typography.titleMd, color: MarketColors.brand },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  statusChip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  statusChipText: { ...Typography.labelSm, fontWeight: '700' },
  cardCondition: { ...Typography.labelSm, color: MarketColors.muted },
  statsRow: { flexDirection: 'row', gap: Spacing.lg, paddingTop: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: MarketColors.border },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { ...Typography.labelMd, color: MarketColors.text, fontWeight: '700' },
  statLabel: { ...Typography.labelSm, color: MarketColors.muted },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  actionHighlight: { borderColor: MarketColors.brand, backgroundColor: MarketColors.okBg },
  actionDisabled: { opacity: 0.5 },
  actionText: { ...Typography.labelSm, color: MarketColors.text, fontWeight: '600' },
  actionTextHighlight: { color: MarketColors.brand },
  // entry
  entryWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  entryIcon: { width: 80, height: 80, borderRadius: 22, backgroundColor: MarketColors.okBg, alignItems: 'center', justifyContent: 'center' },
  entryTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  entryBody: { ...Typography.bodyMd, color: MarketColors.muted, textAlign: 'center' },
  entryCta: { alignSelf: 'stretch', marginTop: Spacing.sm },
  entryPoints: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
  entryPointRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  entryPointText: { ...Typography.labelMd, color: MarketColors.text, flex: 1 },
  // skeleton
  skel: { backgroundColor: MarketColors.surfaceAlt },
  skelBar: { height: 12, borderRadius: 6, backgroundColor: MarketColors.surfaceAlt },
});
