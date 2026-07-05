import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Eye, UserPlus, Clock, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useStreamSummary } from '@/features/connect/live/hooks';

/** End-of-stream summary (PRD §10.7 LB-08): earnings, viewers, new followers. */
export default function EndedSummaryScreen() {
  const q = useStreamSummary();

  if (q.isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Stream ended" showBack={false} /><StateView kind="loading" message="Wrapping up…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><ScreenHeader title="Stream ended" showBack={false} /><StateView kind="error" title="Couldn't load summary" actionLabel="Done" onAction={() => router.replace('/connect/live/discover')} /></SafeAreaView>;
  const s = q.data;
  const mins = Math.floor(s.durationSec / 60);

  const stats = [
    { icon: Clock, label: 'Duration', value: `${mins} min` },
    { icon: Eye, label: 'Peak viewers', value: s.peakViewers.toLocaleString('en-NG') },
    { icon: UserPlus, label: 'New followers', value: `+${s.newFollowers}` },
    { icon: Gift, label: 'Earned', value: formatKobo(s.totalEarningsKobo) },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Stream ended" showBack={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.headline}>Great stream! 🎉</Text>
        <Text style={styles.sub}>Here's how it went.</Text>

        <View style={styles.grid}>
          {stats.map((st) => (
            <View key={st.label} style={styles.statCard}>
              <st.icon size={20} color={ConnectColors.brand} strokeWidth={2.2} />
              <Text style={styles.statValue}>{st.value}</Text>
              <Text style={styles.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.earnBox}>
          <Text style={styles.earnLabel}>Credited to your wallet</Text>
          <Text style={styles.earnValue}>{formatKobo(s.totalEarningsKobo)}</Text>
          <Text style={styles.earnSub}>Gifts {formatKobo(s.giftRevenueKobo)} · Votes {formatKobo(s.voteRevenueKobo)}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="View earnings" variant="secondary" onPress={() => router.replace('/connect/live/broadcaster/earnings')} />
        <View style={{ height: Spacing.sm }} />
        <PrimaryButton label="Done" onPress={() => router.replace('/connect/live/discover')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  headline: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: { width: '47.5%', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md, alignItems: 'flex-start', gap: 4 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  earnBox: { backgroundColor: ConnectColors.brand, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 4 },
  earnLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  earnValue: { ...Typography.displayLg, color: Colors.onPrimary, fontWeight: '800' as const },
  earnSub: { ...Typography.caption, color: Colors.inversePrimary },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border },
});
