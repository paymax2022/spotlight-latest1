import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Vote, ChevronRight } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { ElectionColors } from '../constants/election.constants';
import { countdownLabel } from '../utils/electionFormatters';
import { useActiveElection } from '../hooks/useElection';

/**
 * Steady-on election header banner.
 *
 * Renders nothing unless an estate election window is currently open. Once the
 * admin-set start time arrives (detected via the polling `useActiveElection`
 * query), it stays visible for the whole live window with a one-tap "Vote now"
 * button that navigates residents to the voting page.
 */
export default function ElectionHeaderBanner({ style }: { style?: ViewStyle }) {
  const { data: election } = useActiveElection();
  if (!election) return null;

  return (
    <Pressable
      onPress={() => router.push(`/election?id=${election.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${election.title} is live. Vote now.`}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed, style]}
    >
      <View style={styles.iconBox}>
        <Vote size={22} color={Colors.onPrimary} strokeWidth={2} />
      </View>

      <View style={styles.body}>
        <View style={styles.liveRow}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>ELECTION LIVE</Text>
          <Text style={styles.countdown}>· {countdownLabel(election)}</Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>{election.title}</Text>
      </View>

      <View style={styles.cta}>
        <Text style={styles.ctaText}>Vote now</Text>
        <ChevronRight size={16} color={Colors.primary} strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    ...shadow1,
  },
  pressed: { opacity: 0.92 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ElectionColors.live },
  liveText: { ...Typography.labelSm, color: ElectionColors.live, fontWeight: '800', letterSpacing: 0.5 },
  countdown: { ...Typography.labelSm, color: Colors.inversePrimary },
  title: { ...Typography.labelLg, color: Colors.onPrimary },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.onPrimary,
    borderRadius: Radius.full,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  ctaText: { ...Typography.labelMd, color: Colors.primary },
});
