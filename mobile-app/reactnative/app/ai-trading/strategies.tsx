// ── AI Trading — Strategy maturity (read-only transparency, §12) ──────────────
// Shows members HOW the fund is managed: which strategies run and at what
// validated maturity on the promotion ladder. Read-only — promotion is internal
// governance (separation of duties). Honest framing: nothing touches real capital
// until it climbs the validated ladder, and this build executes nothing live.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldCheck, Info, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useStrategies } from '@/features/aitrading/hooks';
import type { StrategyStage, StrategyMaturity } from '@/features/aitrading/api';
import { HomeMenuButton } from '@/components/HomeMenu';

const STAGE_META: Record<StrategyStage, { label: string; blurb: string; fg: string; bg: string }> = {
  paper:  { label: 'Paper',  blurb: 'Runs on live data with no money at stake — the proving ground.', fg: '#6b21a8', bg: '#f3e8ff' },
  shadow: { label: 'Shadow', blurb: 'Watched alongside the market and benchmarked. Still no money at stake.', fg: '#1d4ed8', bg: '#dbeafe' },
  canary: { label: 'Canary', blurb: 'Cleared for a tiny capped allocation once execution is enabled. Fully risk-gated.', fg: '#b45309', bg: '#fef3c7' },
  live:   { label: 'Live',   blurb: 'Cleared for full allocation once execution is enabled. Fully risk-gated.', fg: '#15803d', bg: '#dcfce7' },
  halted: { label: 'Halted', blurb: 'Stopped after a risk breach. Must re-prove from Paper before running again.', fg: '#b91c1c', bg: '#fee2e2' },
};
const LADDER_ORDER: StrategyStage[] = ['live', 'canary', 'shadow', 'paper', 'halted'];

function StageBadge({ stage }: { stage: StrategyStage }) {
  const m = STAGE_META[stage];
  return <Text style={[styles.badge, { color: m.fg, backgroundColor: m.bg }]}>{m.label.toUpperCase()}</Text>;
}

export default function StrategyMaturityScreen() {
  const q = useStrategies();
  const rows = q.data ?? [];
  const byStage = LADDER_ORDER
    .map((stage) => ({ stage, items: rows.filter((r) => r.stage === stage) }))
    .filter((g) => g.items.length > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/ai-trading')} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.topTitle}>How your fund is managed</Text>
        <HomeMenuButton />
      </View>

      {q.isLoading ? (
        <View style={styles.centre}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} tintColor={Colors.primary} />}>
          <View style={styles.intro}>
            <ShieldCheck size={20} color={Colors.primary} />
            <Text style={styles.introText}>
              Every strategy must climb a validated ladder before it can manage real money. It starts on
              paper with no money at stake, and only advances after independent checks — never automatically.
            </Text>
          </View>

          <View style={styles.note}>
            <Info size={14} color={Colors.onWarning ?? '#8A6D00'} />
            <Text style={styles.noteText}>
              This is transparency only — you can’t change these stages. Live execution isn’t enabled in this
              release, so no strategy is trading real funds yet. No returns are promised, and you can lose money.
            </Text>
          </View>

          {q.isError ? (
            <Text style={styles.err}>Couldn’t load strategies. Pull to retry.</Text>
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>No strategies are being managed yet.</Text>
          ) : (
            byStage.map((g) => (
              <View key={g.stage} style={styles.group}>
                <View style={styles.groupHead}>
                  <StageBadge stage={g.stage} />
                  <Text style={styles.groupBlurb}>{STAGE_META[g.stage].blurb}</Text>
                </View>
                {g.items.map((s: StrategyMaturity) => (
                  <View key={s.strategyId} style={styles.card}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.strategyName}>{s.strategyId.replace(/-/g, ' ')}</Text>
                      <Text style={styles.strategyMeta}>
                        {s.realCapitalEligible ? 'Real-capital eligible (execution stubbed)' : 'Paper / observation only'}
                      </Text>
                    </View>
                    <StageBadge stage={s.stage} />
                  </View>
                ))}
              </View>
            ))
          )}

          <View style={styles.gate}>
            <Lock size={12} color={Colors.onSurfaceVariant} />
            <Text style={styles.gateText}>Promotion is controlled internally with separation of duties and risk sign-off.</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  topTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl },
  intro: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  introText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  note: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: '#FFFBEB', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: '#FDE68A' },
  noteText: { ...Typography.bodySm, color: '#8A6D00', flex: 1, lineHeight: 19 },
  group: { gap: Spacing.xs },
  groupHead: { gap: Spacing.xs, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  groupBlurb: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 17 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  strategyName: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '600', textTransform: 'capitalize' },
  strategyMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  badge: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  err: { ...Typography.bodySm, color: Colors.error, textAlign: 'center', paddingVertical: Spacing.lg },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.lg },
  gate: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: Spacing.sm },
  gateText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
