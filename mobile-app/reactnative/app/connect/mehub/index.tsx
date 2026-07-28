import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Trophy, Flame, Star, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMeSummary } from '@/features/connect/hooks/useConnect';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import TierLimitBar from '@/features/connect/components/TierLimitBar';

// ST-01 detail — My profile preview: profile + wallet/tier summary + gamification.
// Reached from the Me tab. Editing flows are wired in a later slice.
export default function MeProfile() {
  const { data, isLoading, error, refetch } = useMeSummary();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My profile" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load profile" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{data.displayName.charAt(0)}</Text>
            </View>
            <Text style={styles.name}>{data.displayName}</Text>
            {data.headline ? <Text style={styles.headline}>{data.headline}</Text> : null}
            <View style={styles.intentRow}>
              {data.intents.map((it) => (
                <View key={it} style={styles.intentChip}>
                  <Text style={styles.intentChipText}>
                    {it === 'date' ? 'Dating' : it === 'network' ? 'Networking' : 'Discover'}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={styles.section}>Wallet & tier</Text>
          <View style={styles.walletCard}>
            <Text style={styles.walletLabel}>Balance</Text>
            <Text style={styles.walletBalance}>{formatKobo(data.wallet.balanceKobo)}</Text>
          </View>
          <TierLimitBar tier={data.wallet.tier} />

          <Text style={styles.section}>Gamification</Text>
          <View style={styles.gamiCard}>
            <View style={styles.gamiHead}>
              <Trophy size={18} color={Colors.gold} strokeWidth={2} />
              <Text style={styles.gamiTitle}>Level {data.gamification.level}</Text>
            </View>
            <View style={styles.gamiStats}>
              <Stat icon={<Star size={16} color={Colors.secondary} />} value={`${data.gamification.points}`} label="points" />
              <Stat icon={<Flame size={16} color={Colors.error} />} value={`${data.gamification.streakDays}d`} label="streak" />
              <Stat icon={<ShieldCheck size={16} color={Colors.teal} />} value={`${data.gamification.badges}`} label="badges" />
            </View>
          </View>

          <View style={{ marginTop: Spacing.lg }}>
            <PrimaryButton label="Settings & safety" variant="secondary" onPress={() => router.push('/connect/settings')} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  header: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  avatar: {
    width: 80, height: 80, borderRadius: Radius.full,
    backgroundColor: ConnectColors.brand, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...Typography.headlineMd, color: Colors.onPrimary },
  name: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.xs },
  headline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  intentRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  intentChip: { backgroundColor: Colors.iconBgBlue, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  intentChipText: { ...Typography.caption, color: Colors.secondary },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  walletCard: { backgroundColor: ConnectColors.brand, borderRadius: Radius.lg, padding: Spacing.md },
  walletLabel: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  walletBalance: { ...Typography.headlineMd, color: Colors.onPrimary },
  gamiCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm,
  },
  gamiHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gamiTitle: { ...Typography.titleMd, color: Colors.onSurface },
  gamiStats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 2, flex: 1 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
