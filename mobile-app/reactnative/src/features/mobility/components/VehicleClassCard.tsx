import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import { Check, Star, Users, Luggage, Images, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNairaWhole } from '../utils/mobilityFormatters';
import type { VehicleClassMeta } from '../constants/carhireCatalog';

interface Props {
  label: string;
  meta: VehicleClassMeta;
  selected: boolean;
  onPress: () => void;
  /** Opens the full photo + video gallery for this class. */
  onViewGallery?: () => void;
  /** Number of media items in the gallery (for the button label). */
  galleryCount?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iconByName = (name: string): any => (Icons as unknown as Record<string, unknown>)[name] ?? Check;

/** Premium vehicle-class card: gradient hero with the vehicle glyph + starting
 *  price, then class, example models, capacity and amenity chips. */
export default function VehicleClassCard({ label, meta, selected, onPress, onViewGallery, galleryCount }: Props) {
  const Glyph = iconByName(meta.icon);
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} — from ${formatNairaWhole(meta.fromHourlyKobo)} per hour`}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <LinearGradient colors={meta.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.priceTag}>
            <Text style={styles.fromLabel}>FROM</Text>
            <Text style={styles.priceValue}>
              {formatNairaWhole(meta.fromHourlyKobo)}
              <Text style={styles.perHr}> /hr</Text>
            </Text>
          </View>
          {selected ? (
            <View style={[styles.selBadge, { backgroundColor: meta.accent }]}>
              <Check size={16} color="#0B1C30" strokeWidth={3} />
            </View>
          ) : null}
        </View>
        <Glyph size={72} color="rgba(255,255,255,0.92)" strokeWidth={1.6} style={styles.glyph} />
        <View style={[styles.classBadge, { borderColor: meta.accent }]}>
          <Text style={[styles.classBadgeText, { color: meta.accent }]}>{label.toUpperCase()}</Text>
        </View>
      </LinearGradient>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.className} numberOfLines={1}>{label}</Text>
          <View style={styles.rating}>
            <Star size={13} color="#F5A623" fill="#F5A623" strokeWidth={0} />
            <Text style={styles.ratingText}>{meta.rating.toFixed(1)}</Text>
            <Text style={styles.trips}>· {meta.trips}</Text>
          </View>
        </View>
        <Text style={styles.model} numberOfLines={1}>{meta.model}</Text>

        <View style={styles.capRow}>
          <View style={styles.cap}><Users size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.capText}>{meta.seats} seats</Text></View>
          <View style={styles.capDot} />
          <View style={styles.cap}><Luggage size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.capText}>{meta.bags} bags</Text></View>
        </View>

        <View style={styles.amenities}>
          {meta.amenities.map((a) => {
            const AIcon = iconByName(a.icon);
            return (
              <View key={a.label} style={styles.chip}>
                <AIcon size={13} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.chipText}>{a.label}</Text>
              </View>
            );
          })}
        </View>

        {onViewGallery ? (
          <Pressable
            onPress={onViewGallery}
            accessibilityRole="button"
            accessibilityLabel={`View photos and video of the ${label}`}
            style={styles.galleryBtn}
            hitSlop={6}
          >
            <Images size={16} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.galleryBtnText}>
              View gallery{typeof galleryCount === 'number' ? ` · ${galleryCount} photos & video` : ''}
            </Text>
            <ChevronRight size={16} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, overflow: 'hidden',
    borderWidth: 1.5, borderColor: Colors.outlineVariant,
  },
  cardSelected: {
    borderColor: Colors.primary,
    shadowColor: Colors.primary, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  hero: { height: 118, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, justifyContent: 'space-between', overflow: 'hidden' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  priceTag: { backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: Radius.md, paddingVertical: 5, paddingHorizontal: 10 },
  fromLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.5, fontSize: 9 },
  priceValue: { ...Typography.titleMd, color: Colors.white, fontWeight: '800' as const },
  perHr: { ...Typography.labelSm, color: 'rgba(255,255,255,0.8)', fontWeight: '600' as const },
  selBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  glyph: { position: 'absolute', right: 10, bottom: 6 },
  classBadge: { alignSelf: 'flex-start', borderWidth: 1.2, borderRadius: Radius.full, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.22)' },
  classBadgeText: { ...Typography.caption, fontWeight: '800' as const, letterSpacing: 1 },
  info: { padding: Spacing.md, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  className: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const, flexShrink: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  trips: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  model: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  cap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  capText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  capDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingVertical: 5, paddingHorizontal: 9,
  },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  galleryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm,
    paddingVertical: 10, paddingHorizontal: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryFixed,
  },
  galleryBtnText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const, flex: 1 },
});
