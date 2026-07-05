import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Plus, PiggyBank, Repeat, Target, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import VaultCard from '@/features/savings/components/VaultCard';
import AjoCircleCard from '@/features/savings/components/AjoCircleCard';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useSavingsSummary, useVaults, useCircles, useTargets } from '@/features/savings/hooks';
import { SavingsColors, formatNaira, NO_YIELD_DISCLOSURE } from '@/features/savings/constants/savings.constants';

export default function SavingsHome() {
  const summary = useSavingsSummary();
  const vaults = useVaults();
  const circles = useCircles();
  const targets = useTargets();

  const loading = summary.isLoading && vaults.isLoading;
  const errored = summary.isError && vaults.isError;

  const refetchAll = () => { summary.refetch(); vaults.refetch(); circles.refetch(); targets.refetch(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Savings</Text>
        </View>
        <Pressable onPress={() => router.push('/savings/vault/create')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Create vault">
          <Plus size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      {loading ? (
        <StateView kind="loading" message="Loading your savings…" />
      ) : errored ? (
        <StateView kind="error" title="Couldn't load savings" message="Please check your connection and try again." actionLabel="Retry" onAction={refetchAll} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Total saved */}
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total saved</Text>
            <Text style={styles.totalAmount}>{formatNaira(summary.data?.totalSavedKobo ?? 0)}</Text>
            <View style={styles.statsRow}>
              <Stat label="Vaults" value={summary.data?.vaultCount ?? 0} />
              <Stat label="Circles" value={summary.data?.circleCount ?? 0} />
              <Stat label="Targets" value={summary.data?.targetCount ?? 0} />
            </View>
          </View>

          <DisclosureBanner text={NO_YIELD_DISCLOSURE} />

          {/* Quick actions */}
          <View style={styles.actionsRow}>
            <QuickAction icon={PiggyBank} label="New vault" onPress={() => router.push('/savings/vault/create')} />
            <QuickAction icon={Repeat} label="Join Ajo" onPress={() => router.push('/savings/ajo/discover')} />
            <QuickAction icon={Target} label="Group goal" onPress={() => router.push('/savings/target/create')} />
          </View>

          {/* Vaults */}
          <SectionHeader title="Goal vaults" actionLabel="New" onAction={() => router.push('/savings/vault/create')} style={styles.sectionHeader} />
          {(vaults.data?.length ?? 0) === 0 ? (
            <StateView kind="empty" compact title="No vaults yet" message="Create your first vault to start saving toward a goal." actionLabel="Create vault" onAction={() => router.push('/savings/vault/create')} icon="PiggyBank" />
          ) : (
            <View style={styles.list}>
              {vaults.data!.map((v) => (
                <VaultCard key={v.id} vault={v} onPress={() => router.push(`/savings/vault/${v.id}`)} />
              ))}
            </View>
          )}

          {/* Ajo circles */}
          <SectionHeader title="Ajo & Esusu circles" actionLabel="Discover" onAction={() => router.push('/savings/ajo/discover')} style={styles.sectionHeader} />
          {(circles.data?.length ?? 0) === 0 ? (
            <StateView kind="empty" compact title="No circles yet" message="Join or start a rotational savings circle." actionLabel="Discover circles" onAction={() => router.push('/savings/ajo/discover')} icon="Repeat" />
          ) : (
            <View style={styles.list}>
              {circles.data!.map((c) => (
                <AjoCircleCard key={c.id} circle={c} onPress={() => router.push(`/savings/ajo/${c.id}`)} />
              ))}
            </View>
          )}

          {/* Group targets */}
          <SectionHeader title="Group targets" actionLabel="New" onAction={() => router.push('/savings/target/create')} style={styles.sectionHeader} />
          {(targets.data?.length ?? 0) === 0 ? (
            <StateView kind="empty" compact title="No group targets" message="Pool money with friends toward a shared goal." actionLabel="Create target" onAction={() => router.push('/savings/target/create')} icon="Target" />
          ) : (
            <View style={styles.list}>
              {targets.data!.map((t) => {
                const pct = Math.min(100, Math.round((t.savedKobo / t.targetKobo) * 100));
                return (
                  <Pressable key={t.id} onPress={() => router.push(`/savings/target/${t.id}`)} style={({ pressed }) => [styles.targetCard, pressed && { opacity: 0.85 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.targetName}>{t.name}</Text>
                      <Text style={styles.targetSub}>{formatNaira(t.savedKobo)} of {formatNaira(t.targetKobo)} · {pct}%</Text>
                      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
                    </View>
                    <ChevronRight size={18} color={SavingsColors.muted} />
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: typeof PiggyBank; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
      <View style={styles.actionIcon}><Icon size={20} color={SavingsColors.brand} strokeWidth={2} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  totalCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  totalLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  totalAmount: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 36, lineHeight: 42 },
  statsRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  stat: { gap: 2 },
  statValue: { ...Typography.titleLg, color: Colors.onPrimary },
  statLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, paddingVertical: Spacing.md, ...shadow1 },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: SavingsColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelSm, color: SavingsColors.text },
  sectionHeader: { paddingHorizontal: 0, marginTop: Spacing.sm },
  list: { gap: Spacing.md },
  targetCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  targetName: { ...Typography.titleMd, color: SavingsColors.text },
  targetSub: { ...Typography.bodySm, color: SavingsColors.muted, marginVertical: 6 },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: SavingsColors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: SavingsColors.ok },
});
