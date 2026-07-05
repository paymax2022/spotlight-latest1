import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Settings,
  ShieldCheck,
  Trophy,
  Wallet,
  ChevronRight,
  BadgeCheck,
  ScanFace,
  Flame,
  Star,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMeSummary } from '@/features/connect/hooks/useConnect';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import type { VerificationState } from '@/features/connect/types/connect.types';

// ST-01 — Me / hub. Entry to profile, wallet/tier, gamification, settings.
export default function MeTab() {
  const { data, isLoading, error, refetch } = useMeSummary();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Me"
        showBack={false}
        rightSlot={
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push('/connect/settings')}
          >
            <Settings size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading your profile…" />
      ) : error || !data ? (
        <StateView
          kind="error"
          title="Couldn't load profile"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          {/* Identity card */}
          <Pressable style={styles.identity} onPress={() => router.push('/connect/me')}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{data.displayName.charAt(0)}</Text>
            </View>
            <View style={styles.identityBody}>
              <Text style={styles.name}>{data.displayName}</Text>
              {data.headline ? <Text style={styles.headline}>{data.headline}</Text> : null}
              <View style={styles.intentRow}>
                {data.intents.map((it) => (
                  <View key={it} style={styles.intentChip}>
                    <Text style={styles.intentChipText}>{labelForIntent(it)}</Text>
                  </View>
                ))}
              </View>
            </View>
            <ChevronRight size={20} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          {/* Wallet + tier (money surface → must show tier/limit/remaining) */}
          <Pressable style={styles.walletCard} onPress={() => router.push('/connect/settings')}>
            <View style={styles.walletHeader}>
              <View style={styles.walletIcon}>
                <Wallet size={18} color={Colors.onPrimary} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.walletLabel}>Connect wallet</Text>
                <Text style={styles.walletBalance}>{formatKobo(data.wallet.balanceKobo)}</Text>
              </View>
            </View>
          </Pressable>
          <TierLimitBar tier={data.wallet.tier} />

          {/* Verification status */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Verification</Text>
            <VerifRow
              icon="ScanFace"
              label="Liveness check"
              state={data.verification.liveness}
              onPress={() => router.push('/connect/onboarding/liveness')}
            />
            <VerifRow
              icon="BadgeCheck"
              label="BVN / NIN linked"
              state={data.verification.identity}
              onPress={() => router.push('/connect/onboarding/bvn-nin')}
            />
          </View>

          {/* Gamification entry */}
          <Pressable
            style={styles.gamiCard}
            onPress={() => router.push('/connect/me')}
            accessibilityRole="button"
            accessibilityLabel="Gamification"
          >
            <View style={styles.gamiHead}>
              <Trophy size={18} color={Colors.gold} strokeWidth={2} />
              <Text style={styles.gamiTitle}>Level {data.gamification.level}</Text>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} style={{ marginLeft: 'auto' }} />
            </View>
            <View style={styles.gamiStats}>
              <Stat icon={<Star size={16} color={Colors.secondary} />} value={`${data.gamification.points}`} label="points" />
              <Stat icon={<Flame size={16} color={Colors.error} />} value={`${data.gamification.streakDays}d`} label="streak" />
              <Stat icon={<ShieldCheck size={16} color={Colors.teal} />} value={`${data.gamification.badges}`} label="badges" />
            </View>
          </Pressable>

          <Pressable
            style={styles.settingsRow}
            onPress={() => router.push('/connect/settings')}
            accessibilityRole="button"
          >
            <Settings size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.settingsText}>Settings, safety & support</Text>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} style={{ marginLeft: 'auto' }} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function labelForIntent(i: string): string {
  return i === 'date' ? 'Dating' : i === 'network' ? 'Networking' : 'Discover';
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

function VerifRow({
  icon,
  label,
  state,
  onPress,
}: {
  icon: 'ScanFace' | 'BadgeCheck';
  label: string;
  state: VerificationState;
  onPress: () => void;
}) {
  const Icon = icon === 'ScanFace' ? ScanFace : BadgeCheck;
  const passed = state === 'passed';
  return (
    <Pressable style={styles.verifRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={18} color={passed ? Colors.teal : Colors.outline} strokeWidth={2} />
      <Text style={styles.verifLabel}>{label}</Text>
      <View style={[styles.verifPill, passed ? styles.verifPillOk : styles.verifPillPending]}>
        <Text style={[styles.verifPillText, passed ? styles.verifPillTextOk : styles.verifPillTextPending]}>
          {passed ? 'Verified' : state === 'pending' ? 'Pending' : state === 'failed' ? 'Failed' : 'Verify'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 100, gap: Spacing.md },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  avatar: {
    width: 56, height: 56, borderRadius: Radius.full,
    backgroundColor: ConnectColors.brand, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...Typography.titleLg, color: Colors.onPrimary },
  identityBody: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  headline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  intentRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  intentChip: { backgroundColor: Colors.iconBgBlue, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  intentChipText: { ...Typography.caption, color: Colors.secondary },
  walletCard: {
    backgroundColor: ConnectColors.brand,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  walletHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  walletIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center',
  },
  walletLabel: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  walletBalance: { ...Typography.headlineMd, color: Colors.onPrimary },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  cardTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  verifRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  verifLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  verifPill: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  verifPillOk: { backgroundColor: Colors.iconBgTeal },
  verifPillPending: { backgroundColor: Colors.surfaceContainerHigh },
  verifPillText: { ...Typography.caption },
  verifPillTextOk: { color: Colors.teal },
  verifPillTextPending: { color: Colors.onSurfaceVariant },
  gamiCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  gamiHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gamiTitle: { ...Typography.titleMd, color: Colors.onSurface },
  gamiStats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 2, flex: 1 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  settingsText: { ...Typography.labelLg, color: Colors.onSurface },
});
