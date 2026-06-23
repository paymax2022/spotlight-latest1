import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { TriangleAlert, Ban, Clock, CircleCheck, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { RESTRICTION_COPY, VisitorColors } from '../constants/visitor.constants';
import { formatNairaFromKobo } from '../utils/visitorFormatters';
import type { RestrictionStatus } from '../types/visitor.types';

const TONE = {
  ok:      { color: VisitorColors.success, bg: VisitorColors.successBg, Icon: CircleCheck },
  warning: { color: VisitorColors.warning, bg: VisitorColors.warningBg, Icon: TriangleAlert },
  danger:  { color: Colors.error,          bg: Colors.errorContainer,   Icon: Ban },
  pending: { color: Colors.secondary,      bg: Colors.iconBgBlue,       Icon: Clock },
} as const;

interface Props {
  status: RestrictionStatus;
  onPress?: () => void;
}

/**
 * Payment-restriction banner (PRD §10). Renders nothing when the resident is in
 * good standing; otherwise surfaces the restriction state + balance + CTA.
 */
export default function RestrictionBanner({ status, onPress }: Props) {
  if (status.state === 'good_standing') return null;

  const copy = RESTRICTION_COPY[status.state];
  const tone = TONE[copy.tone];
  const { Icon } = tone;
  const showBalance = status.outstandingBalanceKobo > 0 && copy.tone !== 'ok';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.banner, { backgroundColor: tone.bg }]}
    >
      <View style={[styles.iconBox, { backgroundColor: Colors.white }]}>
        <Icon size={20} color={tone.color} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: tone.color }]}>{copy.title}</Text>
        <Text style={styles.message}>{copy.body}</Text>
        {showBalance ? (
          <Text style={[styles.balance, { color: tone.color }]}>
            Outstanding: {formatNairaFromKobo(status.outstandingBalanceKobo)}
          </Text>
        ) : null}
      </View>
      {onPress ? <ChevronRight size={18} color={tone.color} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg },
  message: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  balance: { ...Typography.labelMd, marginTop: 2 },
});
