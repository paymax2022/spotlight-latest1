import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow3 } from '@/constants/shadows';
import { formatMoney } from '../utils/spotlightFormatters';
import type { RewardWallet } from '../types/spotlight.types';

interface Props {
  wallet: RewardWallet;
  onPress?: () => void;
  label?: string;
}

/**
 * Gradient reward-wallet hero card. Reuses the crypto-index gradient-hero
 * pattern. Balance is reward CREDIT earned from learning — never profit.
 */
export default function RewardWalletCard({ wallet, onPress, label = 'Reward wallet balance' }: Props) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${formatMoney(wallet.balance)}`}>
      <LinearGradient
        colors={Colors.gradientPurple as [string, string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, shadow3]}
      >
        <View style={styles.topRow}>
          <View style={styles.iconBadge}><Sparkles size={16} color={Colors.onPrimary} strokeWidth={2} /></View>
          <Text style={styles.label}>{label}</Text>
        </View>
        <Text style={styles.amount}>{formatMoney(wallet.balance)}</Text>
        <Text style={styles.sub}>Earned from lessons, quizzes and challenges</Text>

        {onPress ? (
          <View style={styles.cta}>
            <Text style={styles.ctaText}>View rewards & history</Text>
            <ChevronRight size={16} color={Colors.onPrimary} strokeWidth={2} />
          </View>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    overflow: 'hidden',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBadge: {
    width: 28, height: 28, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  label: { ...Typography.labelSm, color: 'rgba(255,255,255,0.8)' },
  amount: { fontSize: 30, fontWeight: '800', color: Colors.onPrimary, lineHeight: 38, letterSpacing: -0.5, marginTop: Spacing.sm },
  sub: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)', marginTop: Spacing.xs },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: Spacing.md, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  ctaText: { ...Typography.labelMd, color: Colors.onPrimary },
});
