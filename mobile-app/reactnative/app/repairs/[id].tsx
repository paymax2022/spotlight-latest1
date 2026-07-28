import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useRepair, useAddRepairUpdate } from '@/features/repairs/hooks';
import { CATEGORY_META, URGENCY_META, STATUS_META, STATUS_FLOW } from '@/features/repairs/api';
import { formatNairaFromKobo } from '@/features/visitor/utils/visitorFormatters';
import type { RepairStatus } from '@/features/repairs/api';

export default function RepairDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useRepair(id!);
  const addUpdate = useAddRepairUpdate(id!);

  if (isLoading) return <Wrap><StateView kind="loading" message="Loading…" /></Wrap>;
  if (isError || !data) return <Wrap><StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Wrap>;

  const cat = CATEGORY_META[data.category]; const ur = URGENCY_META[data.urgency]; const st = STATUS_META[data.status];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[cat.icon] ?? Icons.Wrench;
  const nextIdx = STATUS_FLOW.indexOf(data.status as RepairStatus);
  const next = nextIdx >= 0 && nextIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[nextIdx + 1] : null;

  const advance = (to: RepairStatus) => Alert.alert('Update status', `Move to "${STATUS_META[to].label}"?`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Update', onPress: () => addUpdate.mutate({ status: to }) },
  ]);

  return (
    <Wrap>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <View style={styles.iconBox}><Icon size={24} color={Colors.secondary} strokeWidth={1.8} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{cat.label}</Text>
            <View style={styles.row}>
              <View style={[styles.chip, { backgroundColor: st.bg }]}><Text style={[styles.chipText, { color: st.color }]}>{st.label}</Text></View>
              <View style={[styles.chip, { backgroundColor: ur.bg }]}><Text style={[styles.chipText, { color: ur.color }]}>{ur.label} urgency</Text></View>
            </View>
          </View>
        </View>
        <Text style={styles.desc}>{data.description}</Text>
        {typeof data.costEstimateKobo === 'number' ? (
          <View style={styles.costBox}><Text style={styles.costLabel}>Estimated cost</Text><Text style={styles.costValue}>{formatNairaFromKobo(data.costEstimateKobo)}</Text></View>
        ) : null}

        <Text style={styles.section}>Activity</Text>
        {(data.updates ?? []).length === 0 ? (
          <Text style={styles.empty}>No updates yet.</Text>
        ) : (
          <View style={styles.timeline}>
            {(data.updates ?? []).map((u) => {
              const us = STATUS_META[u.status as RepairStatus];
              return (
                <View key={u.id} style={styles.tItem}>
                  <View style={[styles.tDot, { backgroundColor: us?.color ?? Colors.outline }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tStatus}>{us?.label ?? u.status}</Text>
                    {u.note ? <Text style={styles.tNote}>{u.note}</Text> : null}
                    <Text style={styles.tMeta}>{u.byName ?? 'Admin'} · {new Date(u.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {next ? (
        <View style={styles.footer}>
          <Pressable onPress={() => advance(next)} accessibilityRole="button" disabled={addUpdate.isPending} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
            <Text style={styles.ctaText}>Mark as {STATUS_META[next].label}</Text>
          </Pressable>
        </View>
      ) : null}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  head: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  iconBox: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  row: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4, flexWrap: 'wrap' },
  chip: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  desc: { ...Typography.bodyMd, color: Colors.onSurface },
  costBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  costLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  costValue: { ...Typography.titleMd, color: Colors.onSurface },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  timeline: { gap: Spacing.md },
  tItem: { flexDirection: 'row', gap: Spacing.sm },
  tDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  tStatus: { ...Typography.labelMd, color: Colors.onSurface },
  tNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  tMeta: { ...Typography.labelSm, color: Colors.outline, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  cta: { height: 52, borderRadius: Radius.lg, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  ctaText: { ...Typography.labelLg, color: Colors.onPrimary },
});
