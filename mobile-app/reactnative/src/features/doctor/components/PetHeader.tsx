import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PawPrint } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  name:        string;
  speciesLabel: string;
  breed:       string;
  meta?:       string;            // e.g. "2 yrs - 58 kg - Male"
  ownerName?:  string;
  color:       string;            // avatar swatch (from data / owner avatarColor)
}

// New component: a pet identity header (paw avatar + name + species/breed +
// owner). DoctorAvatar renders human initials in a circle; a pet needs a paw
// glyph + species/breed line, so a small pet-specific header is justified.
export default function PetHeader({ name, speciesLabel, breed, meta, ownerName, color }: Props) {
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: color }]}>
        <PawPrint size={28} color={Colors.white} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.species} numberOfLines={1}>{speciesLabel} - {breed}</Text>
        {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
        {!!ownerName && <Text style={styles.owner} numberOfLines={1}>Owner: {ownerName}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  avatar:  { width: 64, height: 64, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  body:    { flex: 1, gap: 2 },
  name:    { ...Typography.headlineMd, color: Colors.onSurface },
  species: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  meta:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  owner:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
