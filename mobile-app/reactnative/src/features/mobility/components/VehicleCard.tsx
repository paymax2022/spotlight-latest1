import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Car } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Vehicle } from '../types/mobility.types';
import { SERVICE_TYPE_LABEL } from '../constants/mobility.constants';

interface Props {
  vehicle: Vehicle;
}

/** Vehicle detail block — plate number is the safety check riders must confirm. */
export default function VehicleCard({ vehicle }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Car size={24} color={Colors.secondary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{vehicle.color} {vehicle.make} {vehicle.model}</Text>
        <Text style={styles.sub}>{SERVICE_TYPE_LABEL[vehicle.category]} · {vehicle.year} · {vehicle.capacity} seats</Text>
      </View>
      <View style={styles.plate}>
        <Text style={styles.plateLabel}>PLATE</Text>
        <Text style={styles.plateText}>{vehicle.plateNumber}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  iconWrap: { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  plate: { alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderWidth: 1, borderColor: Colors.outlineVariant },
  plateLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, letterSpacing: 1 },
  plateText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '800' as const, letterSpacing: 0.5 },
});
