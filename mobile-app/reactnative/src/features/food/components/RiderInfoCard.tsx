import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Bike, Star, Phone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { RiderRef } from '../types';

/** Compact rider summary shown on the customer tracking screen once assigned. */
export default function RiderInfoCard({ rider }: { rider: RiderRef }) {
  return (
    <View style={s.card}>
      <View style={s.avatar}>
        <Bike size={22} color={Colors.secondary} strokeWidth={1.8} />
      </View>
      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>
          {rider.name}
        </Text>
        {rider.vehicle ? (
          <Text style={s.meta} numberOfLines={1}>
            {rider.vehicle}
          </Text>
        ) : null}
      </View>
      {rider.rating != null ? (
        <View style={s.ratingPill}>
          <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
          <Text style={s.ratingText}>{rider.rating.toFixed(1)}</Text>
        </View>
      ) : null}
      {rider.phone ? <Phone size={18} color={Colors.secondary} strokeWidth={2} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgBlue,
  },
  body: { flex: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.iconBgGold,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  ratingText: { ...Typography.labelSm, color: Colors.onWarning },
});
