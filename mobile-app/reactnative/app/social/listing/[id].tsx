import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Package, Star, MapPin, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useListing, formatNaira, ESCROW_DISCLOSURE } from '@/features/social/escrow';
import { SocialColors } from '@/features/social/constants/social.constants';

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useListing(id ?? '');
  const sold = listing.data?.status === 'sold';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{listing.data?.title ?? 'Listing'}</Text>
        <View style={styles.iconBtn} />
      </View>

      {listing.isLoading ? (
        <StateView kind="loading" message="Loading listing…" />
      ) : listing.isError || !listing.data ? (
        <StateView kind="error" title="Couldn't load listing" actionLabel="Retry" onAction={() => listing.refetch()} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.hero, { backgroundColor: listing.data.thumbColor }]}><Package size={48} color="#FFFFFF" /></View>
            <Text style={styles.title}>{listing.data.title}</Text>
            <Text style={styles.price}>{formatNaira(listing.data.priceKobo)}</Text>
            <View style={styles.tagRow}>
              <View style={styles.tag}><Text style={styles.tagText}>{listing.data.condition}</Text></View>
              <View style={styles.tag}><Text style={styles.tagText}>{listing.data.category}</Text></View>
              <View style={styles.metaItem}><MapPin size={13} color={SocialColors.muted} /><Text style={styles.metaText}>{listing.data.location}</Text></View>
            </View>

            <Text style={styles.desc}>{listing.data.description}</Text>

            <View style={styles.sellerCard}>
              <Text style={styles.sellerLabel}>Seller</Text>
              <View style={styles.sellerRow}>
                <Text style={styles.sellerName}>{listing.data.sellerName} · {listing.data.sellerHandle}</Text>
                <View style={styles.rating}><Star size={14} color={SocialColors.warn} /><Text style={styles.ratingText}>{listing.data.sellerRating.toFixed(1)}</Text><Text style={styles.sales}>({listing.data.sellerSales} sales)</Text></View>
              </View>
            </View>

            <View style={styles.escrowBanner}>
              <ShieldCheck size={18} color={SocialColors.ok} />
              <Text style={styles.escrowText}>{ESCROW_DISCLOSURE}</Text>
            </View>

            <View style={{ height: 120 }} />
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={sold ? 'Sold' : `Buy with escrow — ${formatNaira(listing.data.priceKobo)}`}
              onPress={() => router.push(`/social/escrow/checkout?listingId=${listing.data!.id}`)}
              disabled={sold}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  hero: { height: 180, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: SocialColors.text, marginTop: Spacing.md },
  price: { ...Typography.titleLg, color: SocialColors.brand, marginTop: 2 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, flexWrap: 'wrap' },
  tag: { backgroundColor: SocialColors.surfaceAlt, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  tagText: { ...Typography.labelSm, color: SocialColors.muted, textTransform: 'capitalize' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: SocialColors.muted },
  desc: { ...Typography.bodyMd, color: SocialColors.text, marginTop: Spacing.md },
  sellerCard: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginTop: Spacing.md, ...shadow1 },
  sellerLabel: { ...Typography.labelSm, color: SocialColors.muted },
  sellerRow: { marginTop: 4 },
  sellerName: { ...Typography.titleMd, color: SocialColors.text },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  ratingText: { ...Typography.labelMd, color: SocialColors.text },
  sales: { ...Typography.labelSm, color: SocialColors.muted },
  escrowBanner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: SocialColors.okBg, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  escrowText: { ...Typography.labelSm, color: SocialColors.text, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
