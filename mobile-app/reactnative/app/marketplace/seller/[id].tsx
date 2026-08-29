// ── Screen 7 — Seller Profile ────────────────────────────────────────────────
// Deeper trust verification before a buyer commits. Avatar, ungameable tenure
// badge (server-computed), verification tier icons, response stats, active
// listings grid, reviews section GATED to real completed-order reviewers — a
// review row structurally cannot exist without a released order behind it.
// New seller shows "New seller — 0 completed orders" plainly, never a hidden
// section (hiding reviews without a logged reason is a compliance anti-pattern).
import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, MessageCircle, Star, ShieldCheck, BadgeCheck, PackageCheck, Flag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira } from '@/features/marketplace';
import { useSellerProfile, useSellerListings, useSellerReviews } from '@/features/marketplace/hooks';
import ListingCard from '@/features/marketplace/components/ListingCard';

export default function SellerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useSellerProfile(id!);
  const listings = useSellerListings(id!);
  const reviews = useSellerReviews(id!);

  if (profile.isLoading && !profile.data) {
    return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading seller…" /></SafeAreaView>;
  }
  if (profile.isError || !profile.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topRow}><Pressable onPress={() => goBack('/marketplace')} hitSlop={10}><ArrowLeft size={22} color={Colors.onSurface} /></Pressable></View>
        <StateView kind="error" title="Couldn't load seller" actionLabel="Retry" onAction={() => profile.refetch()} />
      </SafeAreaView>
    );
  }

  const p = profile.data;
  const reviewList = reviews.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBack('/marketplace')} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.topTitle}>Seller</Text>
        <Pressable
          hitSlop={8}
          accessibilityLabel="Report seller"
          onPress={() =>
            router.push(
              `/marketplace/account/report?targetType=seller&targetId=${id}&targetName=${encodeURIComponent(p.name)}&sellerId=${id}` as never,
            )
          }
        >
          <Flag size={18} color={Colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{p.name[0]?.toUpperCase()}</Text></View>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{p.name}</Text>
            {p.verifiedIdBadge ? <ShieldCheck size={18} color={MarketColors.ok} /> : null}
            {p.verifiedBusinessBadge ? <BadgeCheck size={18} color={MarketColors.brand} /> : null}
          </View>
          <Text style={styles.tenure}>{p.tenureLabel}</Text>
        </View>

        {/* Stat strip */}
        <View style={styles.stats}>
          <View style={styles.stat}><Star size={16} color={MarketColors.warn} fill={MarketColors.warn} /><Text style={styles.statVal}>{(p.trustScore * 5).toFixed(1)}</Text><Text style={styles.statLabel}>Trust</Text></View>
          <View style={styles.stat}><PackageCheck size={16} color={MarketColors.ok} /><Text style={styles.statVal}>{p.completedEscrowCount}</Text><Text style={styles.statLabel}>Completed</Text></View>
          {p.responseTimeMinutes != null ? (
            <View style={styles.stat}><Text style={styles.statVal}>~{p.responseTimeMinutes}m</Text><Text style={styles.statLabel}>Reply time</Text></View>
          ) : null}
        </View>

        <View style={styles.msgWrap}>
          <Pressable style={styles.msgBtn} onPress={() => router.push(`/marketplace/deals?sellerId=${id}` as never)}>
            <MessageCircle size={18} color={MarketColors.brand} />
            <Text style={styles.msgText}>Message</Text>
          </Pressable>
        </View>

        {/* Active listings */}
        <Text style={styles.sectionTitle}>Active listings</Text>
        {listings.isLoading && !listings.data ? (
          <StateView kind="loading" compact />
        ) : (listings.data ?? []).length === 0 ? (
          <StateView kind="empty" icon="PackageOpen" title="No active listings" compact />
        ) : (
          <View style={styles.grid}>
            {(listings.data ?? []).map((l) => (
              <View key={l.id} style={styles.gridCell}>
                <ListingCard item={l} onPress={(lid) => router.push(`/marketplace/listing/${lid}?source=seller` as never)} />
              </View>
            ))}
          </View>
        )}

        {/* Reviews — gated to completed-order reviewers */}
        <Text style={styles.sectionTitle}>Reviews</Text>
        {reviews.isLoading && !reviews.data ? (
          <StateView kind="loading" compact />
        ) : reviewList.length === 0 ? (
          <View style={styles.newSeller}>
            <Text style={styles.newSellerText}>New seller — 0 completed orders</Text>
          </View>
        ) : (
          <View style={styles.reviews}>
            {reviewList.map((r) => (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHead}>
                  <Text style={styles.reviewer}>{r.reviewerName ?? 'Verified buyer'}</Text>
                  <View style={styles.reviewStars}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} size={12} color={MarketColors.warn} fill={i < (r.rating ?? 0) ? MarketColors.warn : 'transparent'} />
                    ))}
                  </View>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : <Text style={styles.reviewCommentMuted}>Rated, no comment left.</Text>}
                {r.tags && r.tags.length > 0 ? (
                  <View style={styles.tagRow}>
                    {r.tags.map((t) => <View key={t} style={styles.tag}><Text style={styles.tagText}>{t.replace(/_/g, ' ')}</Text></View>)}
                  </View>
                ) : null}
                {r.sellerReply ? <Text style={styles.reply}>Seller: {r.sellerReply}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  topTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingBottom: Spacing.xxl, paddingHorizontal: Spacing.containerMargin },
  header: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.headlineMd, color: Colors.onPrimaryContainer },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...Typography.titleLg, color: MarketColors.text },
  tenure: { ...Typography.labelMd, color: MarketColors.muted },
  stats: { flexDirection: 'row', backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, paddingVertical: Spacing.md, marginBottom: Spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { ...Typography.titleMd, color: MarketColors.text },
  statLabel: { ...Typography.labelSm, color: MarketColors.muted },
  msgWrap: { marginBottom: Spacing.lg },
  msgBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: MarketColors.brand, borderRadius: Radius.lg, paddingVertical: 12 },
  msgText: { ...Typography.labelLg, color: MarketColors.brand, fontWeight: '700' },
  sectionTitle: { ...Typography.titleMd, color: MarketColors.text, marginTop: Spacing.md, marginBottom: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridCell: { width: '48%' },
  newSeller: { backgroundColor: MarketColors.surfaceAlt, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center' },
  newSellerText: { ...Typography.bodyMd, color: MarketColors.muted },
  reviews: { gap: Spacing.sm },
  reviewCard: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, padding: Spacing.md, gap: 6 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewer: { ...Typography.labelLg, color: MarketColors.text },
  reviewStars: { flexDirection: 'row', gap: 2 },
  reviewComment: { ...Typography.bodyMd, color: MarketColors.text },
  reviewCommentMuted: { ...Typography.bodyMd, color: MarketColors.muted, fontStyle: 'italic' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: MarketColors.okBg, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 10, color: MarketColors.text, textTransform: 'capitalize' },
  reply: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 4 },
});
