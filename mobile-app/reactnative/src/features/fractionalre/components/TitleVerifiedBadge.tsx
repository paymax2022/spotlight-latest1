import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

export default function TitleVerifiedBadge({ verified, small }: { verified: boolean; small?: boolean }) {
  const color = verified ? Colors.teal : Colors.onWarning;
  const Icon = verified ? ShieldCheck : ShieldAlert;
  return (
    <View style={[styles.badge, { backgroundColor: color + '1A' }, small && styles.small]}>
      <Icon size={small ? 12 : 14} color={color} strokeWidth={2} />
      <Text style={[styles.label, { color }]}>{verified ? 'Title verified' : 'Title pending'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: 6, paddingVertical: 2 },
  label: { ...Typography.labelSm, fontWeight: '600' },
});
