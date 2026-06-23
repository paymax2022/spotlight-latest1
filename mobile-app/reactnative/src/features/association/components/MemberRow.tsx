import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import MembershipStatusBadge from './MembershipStatusBadge';
import { initials } from '../utils/associationFormatters';
import type { MemberProfileSummary } from '../types/association.types';

interface Props {
  member: MemberProfileSummary;
  onPress: () => void;
}

export default function MemberRow({ member: m, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.fullName}, ${m.categoryLabel}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatar}>
        {m.photoUrl ? (
          <Image source={{ uri: m.photoUrl }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarText}>{initials(m.fullName)}</Text>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{m.fullName}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {m.memberId}{m.profession ? ` · ${m.profession}` : ''}
        </Text>
        <View style={styles.metaRow}>
          <MembershipStatusBadge status={m.status} size="sm" />
          <Text style={styles.category} numberOfLines={1}>{m.categoryLabel}</Text>
        </View>
      </View>

      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  pressed: { opacity: 0.7 },
  avatar: {
    width: 48, height: 48, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
  body: { flex: 1, gap: 3 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  category: { ...Typography.caption, color: Colors.outline, flexShrink: 1 },
});
