import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import {
  ArrowLeft, Share2, Heart, BedDouble, Bath, Maximize, MapPin, ShieldCheck,
  Star, MessageCircle, ChevronRight, Images, Flag,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import PrimaryButton from '@/components/PrimaryButton';
import PropertyCard from '@/features/realtor/components/PropertyCard';
import VerificationBadge from '@/features/realtor/components/VerificationBadge';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import AmenityChip from '@/features/realtor/components/AmenityChip';
import DetailRow from '@/features/realtor/components/DetailRow';
import { useListing, useSimilarListings } from '@/features/realtor/hooks/useRealtor';
import { priceLabelFull, formatNaira, bedBathLabel, timeAgo } from '@/features/realtor/utils/realtorFormatters';
import { PROPERTY_TYPE_LABEL, FURNISHING_LABEL, MODE_LABEL } from '@/features/realtor/constants/realtor.constants';

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useListing(String(id));
  const similar = useSimilarListings(String(id));
  const [saved, setSaved] = React.useState(false);

  if (listing.isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StateView kind="loading" message="Loading property…" />
      </SafeAreaView>
    );
  }
  if (listing.isError || !listing.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <FloatingBack />
        <StateView kind="error" icon="Home" title="Listing unavailable" message="This property may have been removed or is no longer available." actionLabel="Back to search" onAction={() => router.replace('/realtor/search')} />
      </SafeAreaView>
    );
  }

  const l = listing.data;
  const total = l.fees.reduce((s, f) => s + f.amount, 0);
  const unavailable = l.status !== 'published';

  const primaryCta = l.mode === 'short_stay'
    ? { label: 'Book a stay', onPress: () => router.push(`/realtor/shortlet/${l.id}/book`) }
    : l.applicationRequired
    ? { label: 'Apply for this property', onPress: () => router.push(`/realtor/apply?listingId=${l.id}`) }
    : l.mode === 'for_sale'
    ? { label: 'Make purchase enquiry', onPress: () => router.push(`/realtor/inspection/book?listingId=${l.id}`) }
    : { label: 'Book inspection', onPress: () => router.push(`/realtor/inspection/book?listingId=${l.id}`) };

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Gallery cover */}
        <Pressable onPress={() => router.push(`/realtor/listing/${l.id}/gallery`)} accessibilityRole="imagebutton" accessibilityLabel="Open photo gallery">
          <Image source={{ uri: l.media[0] }} style={styles.cover} />
          <View style={styles.galleryChip}>
            <Images size={14} color={Colors.white} strokeWidth={2} />
            <Text style={styles.galleryText}>{l.media.length} photos</Text>
          </View>
        </Pressable>

        <SafeAreaView edges={['top']} style={styles.headerOverlay} pointerEvents="box-none">
          <Pressable onPress={() => goBack('/realtor')} style={styles.circleBtn} hitSlop={8} accessibilityLabel="Go back">
            <ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable style={styles.circleBtn} hitSlop={8} accessibilityLabel="Share listing">
              <Share2 size={18} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable style={styles.circleBtn} hitSlop={8} onPress={() => setSaved((s) => !s)} accessibilityLabel={saved ? 'Remove from saved' : 'Save listing'}>
              <Heart size={18} color={saved ? Colors.gold : Colors.onSurface} fill={saved ? Colors.gold : 'transparent'} strokeWidth={2} />
            </Pressable>
          </View>
        </SafeAreaView>

        <View style={styles.body}>
          {unavailable ? (
            <StatusBadge label="This listing is currently unavailable" tone="warning" icon="TriangleAlert" style={{ marginBottom: Spacing.md }} />
          ) : null}

          <View style={styles.modeRow}>
            <StatusBadge label={MODE_LABEL[l.mode]} tone="info" />
            <Text style={styles.posted}>Listed {timeAgo(l.createdAt)}</Text>
          </View>

          <Text style={styles.price}>{priceLabelFull(l)}</Text>
          <Text style={styles.title}>{l.title}</Text>

          <View style={styles.locationRow}>
            <MapPin size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.location}>{l.area}, {l.city}, {l.state}</Text>
          </View>

          {/* Key facts */}
          <View style={styles.factsRow}>
            <Fact icon={<BedDouble size={18} color={Colors.primary} strokeWidth={2} />} value={l.bedrooms > 0 ? `${l.bedrooms}` : 'Studio'} label="Bedrooms" />
            <Fact icon={<Bath size={18} color={Colors.primary} strokeWidth={2} />} value={`${l.bathrooms}`} label="Bathrooms" />
            {l.sizeSqm ? <Fact icon={<Maximize size={18} color={Colors.primary} strokeWidth={2} />} value={`${l.sizeSqm}`} label="sqm" /> : null}
          </View>

          {/* Trust panel */}
          <View style={styles.trustPanel}>
            <VerificationBadge level={l.verification} />
            {l.escrowProtected ? <StatusBadge label="Escrow protected" tone="success" icon="ShieldCheck" /> : null}
            <StatusBadge label={`${PROPERTY_TYPE_LABEL[l.propertyType]} · ${FURNISHING_LABEL[l.furnishing]}`} tone="neutral" />
          </View>

          {/* Agent card */}
          <Pressable style={styles.agentCard} accessibilityRole="button" accessibilityLabel={`Agent ${l.agent.name}`}>
            <Image source={{ uri: l.agent.avatarUrl }} style={styles.agentAvatar} />
            <View style={styles.agentInfo}>
              <View style={styles.agentNameRow}>
                <Text style={styles.agentName} numberOfLines={1}>{l.agent.name}</Text>
                {l.agent.verified ? <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : null}
              </View>
              <View style={styles.agentMeta}>
                <Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                <Text style={styles.agentMetaText}>{l.agent.rating.toFixed(1)} · {l.agent.reviewCount} reviews</Text>
              </View>
            </View>
            <View style={styles.contactBtn}>
              <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
          </Pressable>

          {/* Description */}
          <SectionHeader title="About this property" style={styles.sectionFlush} />
          <Text style={styles.description}>{l.description}</Text>

          {/* Amenities */}
          <SectionHeader title="Amenities" style={styles.sectionFlush} />
          <View style={styles.amenityGrid}>
            {l.amenities.map((a) => <AmenityChip key={a} amenity={a} />)}
          </View>

          {/* Fees */}
          <SectionHeader title="Price breakdown" style={styles.sectionFlush} />
          <View style={styles.feeCard}>
            {l.fees.map((f) => (
              <DetailRow key={f.label} label={f.label} value={formatNaira(f.amount)} refundable={f.refundable} />
            ))}
            <View style={styles.feeDivider} />
            <DetailRow label="Total move-in cost" value={formatNaira(total)} emphasis />
            {l.escrowProtected ? (
              <View style={styles.escrowNote}>
                <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
                <Text style={styles.escrowNoteText}>
                  Refundable deposits are held in escrow and released after a clean move-out inspection.
                </Text>
              </View>
            ) : null}
          </View>

          {/* Report */}
          <Pressable style={styles.reportBtn} accessibilityRole="button" accessibilityLabel="Report this listing">
            <Flag size={15} color={Colors.error} strokeWidth={2} />
            <Text style={styles.reportText}>Report this listing</Text>
          </Pressable>

          {/* Similar */}
          {(similar.data?.length ?? 0) > 0 ? (
            <View style={styles.similar}>
              <SectionHeader title="Similar listings" style={styles.sectionFlush} />
              <FlatList
                horizontal
                data={similar.data}
                keyExtractor={(i) => i.id}
                showsHorizontalScrollIndicator={false}
                ItemSeparatorComponent={() => <View style={{ width: Spacing.md }} />}
                renderItem={({ item }) => (
                  <PropertyCard listing={item} variant="rail" onPress={() => router.push(`/realtor/listing/${item.id}`)} />
                )}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <SafeAreaView edges={['bottom']} style={styles.ctaBar}>
        <View style={styles.ctaInner}>
          {l.inspectionRequired ? (
            <View style={styles.ctaSecondary}>
              <PrimaryButton label="Book inspection" variant="secondary" onPress={() => router.push(`/realtor/inspection/book?listingId=${l.id}`)} />
            </View>
          ) : null}
          <View style={styles.ctaPrimary}>
            <PrimaryButton label={primaryCta.label} onPress={primaryCta.onPress} disabled={unavailable} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Fact({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}>{icon}</View>
      <Text style={styles.factValue}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

function FloatingBack() {
  return (
    <SafeAreaView edges={['top']} style={styles.headerOverlay} pointerEvents="box-none">
      <Pressable onPress={() => goBack('/realtor')} style={styles.circleBtn} hitSlop={8} accessibilityLabel="Go back">
        <ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 120 },
  cover: { width: '100%', height: 300, backgroundColor: Colors.surfaceContainerHigh },
  galleryChip: {
    position: 'absolute',
    bottom: Spacing.md,
    right: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11,28,48,0.55)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  galleryText: { ...Typography.labelSm, color: Colors.white, fontWeight: '600' as const },
  headerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
  },
  headerActions: { flexDirection: 'row', gap: Spacing.sm },
  circleBtn: {
    width: 40, height: 40, borderRadius: Radius.full,
    backgroundColor: 'rgba(248,249,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    ...shadow1,
  },
  body: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    marginTop: -Spacing.lg,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.containerMargin,
  },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  posted: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  price: { ...Typography.headlineMd, color: Colors.onSurface },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.sm },
  location: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  factsRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  fact: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  factIcon: { marginBottom: 2 },
  factValue: { ...Typography.titleMd, color: Colors.onSurface },
  factLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  trustPanel: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.lg },
  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    marginTop: Spacing.lg,
    ...shadow1,
  },
  agentAvatar: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  agentInfo: { flex: 1, gap: 2 },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agentName: { ...Typography.titleMd, color: Colors.onSurface },
  agentMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  agentMetaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  contactBtn: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.xl, marginBottom: Spacing.sm },
  description: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 24 },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  feeCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  feeDivider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  escrowNote: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  escrowNoteText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: Spacing.lg },
  reportText: { ...Typography.labelMd, color: Colors.error },
  similar: { marginTop: Spacing.lg, marginHorizontal: -Spacing.containerMargin, paddingLeft: Spacing.containerMargin },
  ctaBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    ...shadow3,
  },
  ctaInner: { flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  ctaSecondary: { flex: 1 },
  ctaPrimary: { flex: 1.4 },
});
