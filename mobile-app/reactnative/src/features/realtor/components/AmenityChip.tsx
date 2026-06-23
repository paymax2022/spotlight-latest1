import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { AMENITY_ICON, AMENITY_LABEL } from '../constants/realtor.constants';
import type { Amenity } from '../types/realtor.types';

/** Soft-tinted amenity pill (icon enclosure per DESIGN-Mobile.md iconography). */
export default function AmenityChip({ amenity }: { amenity: Amenity }) {
  const IconCmp =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[AMENITY_ICON[amenity]] ?? Icons.Check;
  return (
    <View style={styles.chip}>
      <IconCmp size={16} color={Colors.secondary} strokeWidth={2} />
      <Text style={styles.label}>{AMENITY_LABEL[amenity]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  label: { ...Typography.bodySm, color: Colors.onSurface },
});
