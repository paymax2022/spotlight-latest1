import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Wallet, Gift, Store, CreditCard, ArrowUpRight, ArrowDownLeft, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import { useWallet } from '@/features/academy/hooks';
import { formatNaira, formatDate, formatPoints } from '@/features/academy/constants';

/** W1 — Wallet & rewards balance. Spendable vs reward points; mini-statement. */
export default function WalletScreen() {
  const wallet = useWallet();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Wallet & store" subtitle="Pay, unlock and earn" />
      <OfflineBanner />
      {wallet.isLoading ? (
        <StateView kind="loading" message="Loading wallet…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
            <Wallet size={22} color={Colors.onPrimary} />
            <Text style={styles.heroBal}>{formatNaira(wallet.data?.spendableKobo)}</Text>
            <Text style={styles.heroLabel}>spendable balance</Text>
            <View style={styles.rewardRow}>
              <Gift size={14} color={Colors.gold} />
              <Text style={styles.rewardText}>{formatPoints(wallet.data?.rewardPoints)} (non-cash)</Text>
            </View>
          </LinearGradient>

          {/* Quick actions */}
          <View style={styles.actions}>
            <Action icon={Store} label="Exam store" onPress={() => router.push('/learn/academy/store')} />
            <Action icon={CreditCard} label="Access card" onPress={() => router.push('/learn/academy/store/access-card')} />
            <Action icon={Sparkles} label="Redeem" onPress={() => router.push('/learn/academy/rewards/redeem')} />
          </View>

          {/* Mini-statement */}
          <Text style={styles.section}>Recent</Text>
          {wallet.data?.recent.map((t) => (
            <View key={t.id} style={[styles.row, shadow1]}>
              <View style={[styles.rowIcon, { backgroundColor: t.kind === 'debit' ? Colors.iconBgRed : Colors.iconBgTeal }]}>
                {t.kind === 'debit' ? <ArrowUpRight size={16} color={Colors.error} /> : <ArrowDownLeft size={16} color={Colors.teal} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t.label}</Text>
                <Text style={styles.rowMeta}>{formatDate(t.ts)}</Text>
              </View>
              <Text style={[styles.rowAmt, { color: t.kind === 'debit' ? Colors.error : Colors.teal }]}>
                {t.kind === 'reward' ? `+${t.points} pts` : `${t.kind === 'debit' ? '-' : '+'}${formatNaira(t.amountKobo)}`}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Action({ icon: Icon, label, onPress }: { icon: typeof Store; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.action, shadow1]} onPress={onPress}>
      <Icon size={22} color={Colors.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg },
  heroBal: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 40, letterSpacing: -0.8, lineHeight: 46, marginTop: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.sm },
  rewardText: { ...Typography.labelSm, color: Colors.gold },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.bodyMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowAmt: { ...Typography.titleMd },
});
