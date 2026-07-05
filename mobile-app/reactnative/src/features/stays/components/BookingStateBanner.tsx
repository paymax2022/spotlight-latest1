import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { StaysColors } from '../constants/stays.constants';
import type { ReservationState } from '../types';

type Tone = 'ok' | 'warn' | 'danger' | 'info';

interface Config {
  tone: Tone;
  icon: string;
  title: string;
  message: string;
}

const STATE_CONFIG: Partial<Record<ReservationState, Config>> = {
  CONFIRMED: { tone: 'ok', icon: 'CircleCheckBig', title: 'Booking confirmed', message: 'Your room is held and the hotel has your reservation.' },
  COMPLETED: { tone: 'ok', icon: 'CircleCheckBig', title: 'Stay completed', message: 'We hope you enjoyed your stay. Leave a review!' },
  PAYMENT_HELD: { tone: 'info', icon: 'Clock', title: 'Confirming with the hotel', message: 'Your wallet is held — not charged — until the hotel confirms.' },
  BOOKING: { tone: 'info', icon: 'Loader', title: 'Booking in progress', message: 'Securing your room with the hotel…' },
  BOOK_FAILED: { tone: 'danger', icon: 'TriangleAlert', title: 'Booking could not be confirmed', message: 'Your hold was released — you were not charged.' },
  PAYMENT_FAILED: { tone: 'danger', icon: 'TriangleAlert', title: 'Payment failed', message: 'No money was held. Please try again.' },
  PREBOOK_FAILED: { tone: 'warn', icon: 'CircleAlert', title: 'Price or availability changed', message: 'We re-checked live rates. Review before continuing.' },
  CANCELLED_BY_GUEST: { tone: 'warn', icon: 'CircleAlert', title: 'Cancelled', message: 'This booking was cancelled. Refunds (if any) go to your wallet.' },
  CANCELLED_BY_HOTEL: { tone: 'danger', icon: 'TriangleAlert', title: 'Cancelled by hotel', message: 'You were fully refunded plus goodwill credit.' },
  NO_SHOW: { tone: 'danger', icon: 'CircleAlert', title: 'No-show', message: 'A policy charge was applied per the rate plan.' },
  VOID: { tone: 'warn', icon: 'CircleAlert', title: 'Voided', message: 'This booking did not complete. No charge was made.' },
};

const TONE: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: Colors.iconBgTeal, fg: StaysColors.ok },
  warn: { bg: Colors.iconBgGold, fg: Colors.onWarning },
  danger: { bg: Colors.errorContainer, fg: Colors.error },
  info: { bg: Colors.iconBgBlue, fg: StaysColors.accent },
};

interface Props {
  state: ReservationState;
  /** Override the default copy. */
  title?: string;
  message?: string;
}

/**
 * State banner for a reservation/booking. Centralises the lifecycle copy so the
 * processing / failure / confirmation / trips screens (SM1 + SM2) stay consistent
 * — especially the auto-release reassurance on failure.
 */
export default function BookingStateBanner({ state, title, message }: Props) {
  const cfg = STATE_CONFIG[state] ?? { tone: 'info' as Tone, icon: 'Info', title: state, message: '' };
  const tone = TONE[cfg.tone];
  const IconCmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[cfg.icon] ?? Icons.Info;
  return (
    <View style={[styles.banner, { backgroundColor: tone.bg }]}>
      <View style={[styles.iconBox, { backgroundColor: Colors.surfaceContainerLowest }]}>
        <IconCmp size={22} color={tone.fg} strokeWidth={2} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: tone.fg }]}>{title ?? cfg.title}</Text>
        <Text style={styles.message}>{message ?? cfg.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1 },
  title: { ...Typography.titleMd, fontWeight: '700' as const },
  message: { ...Typography.bodySm, color: Colors.onSurface, marginTop: 2 },
});
