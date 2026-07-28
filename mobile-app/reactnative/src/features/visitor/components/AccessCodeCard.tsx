import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StatusPill from './StatusPill';
import { codeTypeMeta } from '../constants/visitor.constants';
import { effectiveStatus, formatCodeValue, timeUntil } from '../utils/visitorFormatters';
import type { AccessCode } from '../types/visitor.types';

interface Props {
  code: AccessCode;
  onPress?: () => void;
}

/** Summary card for one access code (used in dashboard, active & history lists). */
export default function AccessCodeCard({ code, onPress }: Props) {
  const meta = codeTypeMeta(code.codeType);
  const status = effectiveStatus(code);
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.UserRound;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} code for ${code.visitor.name}, ${status}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
        <Icon size={22} color={meta.accent} strokeWidth={1.8} />
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>{code.visitor.name}</Text>
          <StatusPill status={status} />
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {meta.label} · {formatCodeValue(code.codeValue)}
          {code.partySize > 1 ? ` · ${code.partySize} guests` : ''}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {status === 'active' ? timeUntil(code.validityEnd) : `${code.entriesUsed}/${code.maxEntries} entries used`}
        </Text>
      </View>

      {onPress ? <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    ...shadow1,
  },
  pressed: { opacity: 0.85 },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sub: { ...Typography.labelSm, color: Colors.outline },
});
