import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { SPECIES_META } from '../constants';
import PetAvatar from './PetAvatar';
import type { Pet } from '../types';

/** Pet row used on the vet hub / My Pets list. */
export default function PetCard({ pet, onPress }: { pet: Pet; onPress: () => void }) {
  const species = SPECIES_META[pet.species];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${pet.name}, ${species.label}`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <PetAvatar species={pet.species} color={pet.avatarColor} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {pet.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {species.label} · {pet.breed} · {pet.ageLabel}
        </Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  pressed: { opacity: 0.9 },
  body: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, fontSize: 17, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
