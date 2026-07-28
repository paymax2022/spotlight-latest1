import React from 'react';
import { View, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { SPECIES_META } from '../constants';
import { Radius } from '@/constants/radius';
import type { PetSpecies } from '../types';

/** Round species-tinted avatar used on pet cards, charts and consult headers. */
export default function PetAvatar({
  species,
  color,
  size = 48,
}: {
  species: PetSpecies;
  color?: string;
  size?: number;
}) {
  const meta = SPECIES_META[species];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.PawPrint;
  return (
    <View
      style={[styles.box, { width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? meta.bg }]}
      accessibilityLabel={meta.label}
    >
      <Icon size={size * 0.45} color={meta.color} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full },
});
