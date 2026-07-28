import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Star, MapPin, ChevronRight, Heart, Images, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ReviewScore } from '@/features/stays/components';
import { useProperty, useToggleSaved } from '@/features/stays/hooks';
import { isSavedSync } from '@/features/stays/api';
import {
  formatMoney, formatNairaCompact, usdCentsToNgnKobo,
  AMENITY_LABEL, AMENITY_ICON, StaysColors,
} from '@/features/stays/constants/stays.constants';

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prop = useProperty(String(id));
  const toggleSave = useToggleSaved();
  const saved = isSavedSync(String(id));

  if (prop.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="" /><StateView kind="loading" message="Loading property…" /></SafeAreaView>;
  }
  if (prop.isError || !prop.data) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="" /><StateView kind="error" title="Couldn't load property" actionLabel="Retry" onAction={() => prop.refetch()} /></SafeAreaView>;
  }

  const p = prop.data;
  const ngnNote = p.currency === 'USD' ? `≈ ${formatNairaCompact(usdCentsToNgnKobo(p.leadPriceMinor))}` : null;
  const topAmenities = p.amenities.slice(0, 6);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={p.name}
        showBack
        rightSlot={
          <Pressable onPress={() => toggleSave.mutate(p.id)} hitSlop={8} accessibilityLabel={saved ? 'Unsave' : 'Save'}>
            <Heart size={22} color={saved ? Colors.gold : Colors.onSurface} fill={saved ? Colors.gold : 'transparent'} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <Pressable onPress={() => router.push(`/stays/property/${p.id}/gallery`)}>
          <Image source={{ uri: p.coverUrl }} style={styles.hero} />
          <View style={styles.galleryBtn}>
            <Images size={14} color={Colors.white} />
            <Text style={styles.galleryBtnText}>{p.media.length} photos</Text>
          </View>
        </Pressable>

        <View style={styles.body}>
          <View style={styles.starsRow}>
            {Array.from({ length: p.star }).map((_, i) => (
              <Star key={i} size={14} color={StaysColors.loyalty} fill={StaysColors.loyalty} strokeWidth={1} />
            ))}
            <Text style={styles.typeText}>{p.propertyType}</Text>
          </View>

          <Text style={styles.name}>{p.name}</Text>

          <Pressable style={styles.locRow} onPress={() => router.push(`/stays/property/${p.id}/location`)}>
            <MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.loc}>{p.address}</Text>
            <ChevronRight size={16} color={Colors.onSurfaceVariant} />
          </Pressable>

          <Pressable style={styles.scoreCard} onPress={() => router.push(`/stays/property/${p.id}/reviews`)}>
            <ReviewScore score={p.reviewScore} reviewCount={p.reviewCount} />
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>

          <Text style={styles.desc}>{p.description}</Text>

          {/* Amenities preview */}
          <Pressable style={styles.sectionCard} onPress={() => router.push(`/stays/property/${p.id}/amenities`)}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Amenities</Text>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </View>
            <View style={styles.amenityWrap}>
              {topAmenities.map((a) => {
                const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[AMENITY_ICON[a] ?? 'Check'] ?? Icons.Check;
                return (
                  <View key={a} style={styles.amenityItem}>
                    <Icon size={16} color={StaysColors.brand} strokeWidth={2} />
                    <Text style={styles.amenityLabel}>{AMENITY_LABEL[a] ?? a}</Text>
                  </View>
                );
              })}
            </View>
          </Pressable>

          {/* Quick links */}
          <NavRow label="Location & map" onPress={() => router.push(`/stays/property/${p.id}/location`)} />
          <NavRow label="Guest reviews & sub-scores" onPress={() => router.push(`/stays/property/${p.id}/reviews`)} />
          <NavRow label="Policies & house rules" onPress={() => router.push(`/stays/property/${p.id}/policies`)} />

          {p.freeCancellation ? (
            <View style={styles.assurance}>
              <ShieldCheck size={16} color={StaysColors.ok} strokeWidth={2} />
              <Text style={styles.assuranceText}>Free cancellation available · confirmed inventory · instant wallet refunds</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.footerLabel}>From</Text>
          <Text style={styles.footerPrice}>{formatMoney(p.leadPriceMinor, p.currency)}</Text>
          <Text style={styles.footerNote}>per night{ngnNote ? `  ·  ${ngnNote}` : ''}</Text>
        </View>
        <View style={styles.footerBtn}>
          <PrimaryButton label="See rooms" onPress={() => router.push(`/stays/property/${p.id}/rooms`)} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.navRow} onPress={onPress}>
      <Text style={styles.navLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 120 },
  hero: { width: '100%', height: 240, backgroundColor: Colors.surfaceContainerHigh },
  galleryBtn: { position: 'absolute', bottom: Spacing.md, right: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(11,28,48,0.6)', paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full },
  galleryBtnText: { ...Typography.labelSm, color: Colors.white, fontWeight: '600' as const },
  body: { padding: Spacing.containerMargin, gap: Spacing.sm },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  typeText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'capitalize', marginLeft: 6 },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  scoreCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  desc: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.sm },
  sectionCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  amenityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  amenityItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '47%' },
  amenityLabel: { ...Typography.bodySm, color: Colors.onSurface },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  navLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  assuranceText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
  footerLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footerPrice: { ...Typography.titleLg, color: Colors.onSurface },
  footerNote: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footerBtn: { width: 160 },
});
