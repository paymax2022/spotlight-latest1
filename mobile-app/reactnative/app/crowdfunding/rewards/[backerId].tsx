import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Check, Truck, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useRewardBackers, useUpdateRewardStatus } from '@/features/crowdfunding/hooks/useExtras';
import { STATUS_META } from './index';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { RewardFulfilmentStatus } from '@/features/crowdfunding/types/crowdfunding.types';

const FLOW: RewardFulfilmentStatus[] = ['PENDING_PRODUCTION', 'READY', 'SHIPPED', 'DELIVERED'];
const ALL_STATUSES: RewardFulfilmentStatus[] = ['PENDING_PRODUCTION', 'READY', 'SHIPPED', 'DELIVERED', 'DELAYED', 'CANCELLED'];

export default function RewardFulfilmentDetail() {
  const { backerId } = useLocalSearchParams<{ backerId: string }>();
  const { data, isLoading, isError, refetch } = useRewardBackers();
  const update = useUpdateRewardStatus();
  const backer = (data ?? []).find((b) => b.id === backerId);
  const [pending, setPending] = useState<RewardFulfilmentStatus | null>(null);

  if (isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Reward" /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !backer) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Reward" /><StateView kind="error" title="Backer not found" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  const current = pending ?? backer.status;
  const stepIndex = FLOW.indexOf(current);
  const meta = STATUS_META[current];

  const save = () => {
    if (pending && pending !== backer.status) update.mutate({ backerId: backer.id, status: pending });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reward fulfilment" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <View style={styles.iconBox}>
            {backer.requiresShipping ? <Truck size={24} color={Colors.primary} strokeWidth={2} /> : <Package size={24} color={Colors.primary} strokeWidth={2} />}
          </View>
          <Text style={styles.name}>{backer.backerName}</Text>
          <Text style={styles.tier}>{backer.rewardTierTitle} · {formatNaira(backer.amountKobo)}</Text>
          <View style={[styles.statusChip, { backgroundColor: meta.bg }]}><Text style={[styles.statusText, { color: meta.fg }]}>{meta.label}</Text></View>
        </View>

        {backer.requiresShipping && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Shipping</Text>
            <Text style={styles.cardValue}>{backer.shippingCity ?? '—'}</Text>
          </View>
        )}

        {/* Fulfilment progress */}
        {stepIndex >= 0 && (
          <View style={styles.flow}>
            {FLOW.map((s, i) => (
              <View key={s} style={styles.flowStep}>
                <View style={[styles.flowDot, i <= stepIndex && styles.flowDotActive]}>{i <= stepIndex && <Check size={12} color={Colors.onPrimary} strokeWidth={3} />}</View>
                <Text style={[styles.flowLabel, i <= stepIndex && styles.flowLabelActive]}>{STATUS_META[s].label}</Text>
                {i < FLOW.length - 1 && <View style={[styles.flowLine, i < stepIndex && styles.flowLineActive]} />}
              </View>
            ))}
          </View>
        )}

        <Text style={styles.label}>Update status</Text>
        <View style={styles.statusGrid}>
          {ALL_STATUSES.map((s) => {
            const active = current === s;
            return (
              <Pressable key={s} style={[styles.statusOption, active && styles.statusOptionActive]} onPress={() => setPending(s)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.statusOptionText, active && styles.statusOptionTextActive]}>{STATUS_META[s].label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Save status" onPress={save} disabled={!pending || pending === backer.status} loading={update.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  head: { alignItems: 'center', gap: 6, paddingVertical: Spacing.lg },
  iconBox: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  tier: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  statusChip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, marginTop: 4 },
  statusText: { ...Typography.labelSm, fontWeight: '600' as const },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.md },
  cardTitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cardValue: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 2 },
  flow: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.lg, gap: Spacing.sm },
  flowStep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, position: 'relative' },
  flowDot: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  flowDotActive: { backgroundColor: Colors.tertiaryContainer },
  flowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  flowLabelActive: { color: Colors.onSurface, fontWeight: '600' as const },
  flowLine: { position: 'absolute', left: 10, top: 22, width: 2, height: Spacing.sm + 2, backgroundColor: Colors.surfaceContainerHigh },
  flowLineActive: { backgroundColor: Colors.tertiaryContainer },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statusOption: { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 9 },
  statusOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  statusOptionText: { ...Typography.labelSm, color: Colors.onSurface },
  statusOptionTextActive: { color: Colors.onPrimary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
