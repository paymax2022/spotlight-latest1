import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Handshake } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  sponsorName: string;
  label?: string;
}

export default function SponsorBanner({ sponsorName, label = 'Proudly sponsored by' }: Props) {
  return (
    <View style={styles.wrap}>
      <Handshake size={16} color={Colors.onSurfaceVariant} strokeWidth={1.5} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.name}>{sponsorName}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.xs,
    backgroundColor:   Colors.surfaceContainerLow,
    borderRadius:      Radius.full,
    paddingVertical:   8,
    paddingHorizontal: Spacing.md,
    alignSelf:         'flex-start',
  },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  name:  { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
});
