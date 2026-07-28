import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { MapPin, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import CredentialBadge from '../../components/CredentialBadge';
import { formatNaira } from '../../constants/health.constants';
import { APPT_TYPE_META } from '../constants';
import StarRating from './StarRating';
import type { Vet } from '../types';

/** Vet discovery row — credential (HL-2), rating, distance, fee, types. */
export default function VetCard({ vet, onPress }: { vet: Vet; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${vet.name}, ${vet.headline}`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{vet.name.replace(/^Dr\.?\s*/, '').charAt(0)}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {vet.name}
          </Text>
          <Text style={styles.headline} numberOfLines={1}>
            {vet.headline}
          </Text>
          <View style={styles.ratingRow}>
            <StarRating rating={vet.rating} count={vet.reviewCount} />
            {vet.availableNow ? (
              <View style={styles.nowChip}>
                <View style={styles.nowDot} />
                <Text style={styles.nowText}>Available now</Text>
              </View>
            ) : null}
          </View>
        </View>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
      </View>

      <CredentialBadge credential={vet.credential} showLicense />

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.metaText} numberOfLines={1}>
            {vet.clinicName} · {vet.distanceLabel}
          </Text>
        </View>
      </View>

      <View style={styles.foot}>
        <View style={styles.types}>
          {vet.types.map((t) => {
            const m = APPT_TYPE_META[t];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Video;
            return (
              <View key={t} style={[styles.typeChip, { backgroundColor: m.bg }]}>
                <Icon size={12} color={m.color} strokeWidth={2} />
                <Text style={[styles.typeText, { color: m.color }]}>{m.label}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.fee}>{formatNaira(vet.consultFeeKobo)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pressed: { opacity: 0.9 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleLg, color: Colors.primary },
  info: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, fontSize: 17, color: Colors.onSurface },
  headline: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2, flexWrap: 'wrap' },
  nowChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  nowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.teal },
  nowText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  metaRow: { gap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.sm },
  types: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  typeText: { ...Typography.caption, fontWeight: '600' as const },
  fee: { ...Typography.titleMd, fontSize: 16, color: Colors.primary },
});
