import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Star, MapPin, Users, Coffee, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import AmenityChip from '@/features/realtor/components/AmenityChip';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useHotel } from '@/features/realtor/hooks/useRealtorHotel';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function HotelDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const hotel = useHotel(String(id));

  if (hotel.isLoading) return <SafeAreaView style={styles.safe}><StateView kind="loading" message="Loading hotel…" /></SafeAreaView>;
  if (!hotel.data) return <SafeAreaView style={styles.safe}><StateView kind="error" title="Hotel unavailable" actionLabel="Back" onAction={() => goBack('/realtor/hotel')} /></SafeAreaView>;
  const h = hotel.data;

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Image source={{ uri: h.media[0] ?? h.coverUrl }} style={styles.cover} />
        <SafeAreaView edges={['top']} style={styles.headerOverlay} pointerEvents="box-none">
          <Pressable onPress={() => goBack('/realtor/hotel')} style={styles.circleBtn} hitSlop={8} accessibilityLabel="Back"><ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} /></Pressable>
          <View style={{ flex: 1 }} />
          <HomeMenuButton />
        </SafeAreaView>

        <View style={styles.body}>
          <View style={styles.starsRow}>
            {Array.from({ length: h.starRating }).map((_, i) => <Star key={i} size={14} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />)}
            <Text style={styles.score}>{h.reviewScore.toFixed(1)} / 10</Text>
          </View>
          <Text style={styles.name}>{h.name}</Text>
          <View style={styles.locRow}><MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.loc}>{h.area}, {h.city}</Text></View>
          <Text style={styles.desc}>{h.description}</Text>

          <SectionHeader title="Amenities" style={styles.sectionFlush} />
          <View style={styles.amenities}>{h.amenities.map((a) => <AmenityChip key={a} amenity={a} />)}</View>

          <SectionHeader title="Choose a room" style={styles.sectionFlush} />
          {h.roomTypes.map((rt) => (
            <View key={rt.id} style={styles.roomCard}>
              <Image source={{ uri: rt.photoUrl }} style={styles.roomPhoto} />
              <View style={styles.roomBody}>
                <View style={styles.roomHead}>
                  <Text style={styles.roomName}>{rt.name}</Text>
                  <StatusBadge label={rt.availableRooms > 0 ? `${rt.availableRooms} left` : 'Sold out'} tone={rt.availableRooms > 0 ? 'success' : 'error'} />
                </View>
                <View style={styles.roomMeta}><Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.roomMetaText}>Up to {rt.capacity} guests</Text></View>
                {rt.ratePlans.map((rp) => (
                  <Pressable
                    key={rp.id}
                    disabled={rt.availableRooms === 0}
                    style={[styles.plan, rt.availableRooms === 0 && styles.planDisabled]}
                    onPress={() => router.push(`/realtor/hotel/${h.id}/book?roomTypeId=${rt.id}&ratePlanId=${rp.id}`)}
                  >
                    <View style={styles.planInfo}>
                      <Text style={styles.planName}>{rp.name}</Text>
                      <View style={styles.planTags}>
                        {rp.includesBreakfast ? <View style={styles.planTag}><Coffee size={11} color={Colors.tertiaryContainer} strokeWidth={2} /><Text style={styles.planTagText}>Breakfast</Text></View> : null}
                        {rp.refundable ? <View style={styles.planTag}><Check size={11} color={Colors.tertiaryContainer} strokeWidth={2.4} /><Text style={styles.planTagText}>Refundable</Text></View> : null}
                      </View>
                    </View>
                    <Text style={styles.planPrice}>{formatNaira(rp.nightly)}<Text style={styles.planPer}>/night</Text></Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xl },
  cover: { width: '100%', height: 240, backgroundColor: Colors.surfaceContainerHigh },
  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  circleBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(248,249,255,0.92)', alignItems: 'center', justifyContent: 'center', ...shadow1 },
  body: { backgroundColor: Colors.background, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, marginTop: -Spacing.lg, paddingTop: Spacing.lg, paddingHorizontal: Spacing.containerMargin },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  score: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginLeft: Spacing.sm },
  name: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: 4 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  loc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginTop: Spacing.md },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.xl, marginBottom: Spacing.sm },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  roomCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden', marginBottom: Spacing.md, ...shadow1 },
  roomPhoto: { width: '100%', height: 120, backgroundColor: Colors.surfaceContainerHigh },
  roomBody: { padding: Spacing.md, gap: Spacing.sm },
  roomHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomName: { ...Typography.titleMd, color: Colors.onSurface },
  roomMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roomMetaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  plan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  planDisabled: { opacity: 0.5 },
  planInfo: { flex: 1, gap: 4 },
  planName: { ...Typography.labelLg, color: Colors.onSurface },
  planTags: { flexDirection: 'row', gap: Spacing.sm },
  planTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  planTagText: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  planPrice: { ...Typography.titleMd, color: Colors.primary },
  planPer: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
