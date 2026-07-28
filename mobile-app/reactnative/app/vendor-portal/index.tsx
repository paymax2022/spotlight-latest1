import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useVendorJobs, useUpdateJobStatus } from '@/features/vendors/hooks';
import { JOB_STATUS_META, NEXT_JOB_ACTIONS } from '@/features/vendors/api';
import { formatNairaFromKobo, relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { VendorJob } from '@/features/vendors/api';

type Tab = 'active' | 'done';
const ACTIVE: string[] = ['available', 'accepted', 'en_route', 'in_progress'];

export default function VendorPortalScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useVendorJobs();
  const update = useUpdateJobStatus();
  const [tab, setTab] = useState<Tab>('active');

  const jobs = useMemo(() => (data ?? []).filter((j) => tab === 'active' ? ACTIVE.includes(j.status) : !ACTIVE.includes(j.status)), [data, tab]);

  const renderItem = ({ item }: { item: VendorJob }) => {
    const st = JOB_STATUS_META[item.status];
    const actions = NEXT_JOB_ACTIONS[item.status] ?? [];
    const busy = update.isPending && update.variables?.id === item.id;
    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.iconBox}><Briefcase size={18} color={Colors.primary} strokeWidth={1.8} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{item.vendorName ?? 'Job'}{item.repairRequestId ? ' · repair' : ''}</Text>
            <Text style={styles.meta}>{relativeTime(item.createdAt)}</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: st.bg }]}><Text style={[styles.chipText, { color: st.color }]}>{st.label}</Text></View>
        </View>
        {item.amountKobo > 0 ? <Text style={styles.amount}>{formatNairaFromKobo(item.amountKobo)}</Text> : null}
        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable key={a.status} onPress={() => update.mutate({ id: item.id, status: a.status })} disabled={busy} accessibilityRole="button"
                style={({ pressed }) => [styles.actBtn, a.tone === 'danger' ? styles.actDanger : styles.actPrimary, pressed && { opacity: 0.85 }, busy && { opacity: 0.6 }]}>
                <Text style={[styles.actText, a.tone === 'danger' ? styles.actTextDanger : styles.actTextPrimary]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My Jobs" subtitle="Vendor portal" />
      <View style={styles.segment}>
        {(['active', 'done'] as Tab[]).map((t) => {
          const selected = t === tab;
          return (
            <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.segItem, selected && { backgroundColor: Colors.surfaceContainerLowest }]}>
              <Text style={[styles.segText, selected && { color: Colors.primary }]}>{t === 'active' ? 'Active' : 'Completed'}</Text>
            </Pressable>
          );
        })}
      </View>
      {isLoading ? <StateView kind="loading" message="Loading jobs…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={jobs} keyExtractor={(j) => j.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="Briefcase" title={tab === 'active' ? 'No active jobs' : 'No completed jobs'} message={tab === 'active' ? 'New job offers will appear here.' : 'Finished jobs appear here.'} />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segment: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: 4, gap: 4 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.DEFAULT },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actBtn: { flex: 1, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  actPrimary: { backgroundColor: Colors.primary },
  actDanger: { backgroundColor: Colors.errorContainer },
  actText: { ...Typography.labelMd, fontWeight: '700' },
  actTextPrimary: { color: Colors.onPrimary },
  actTextDanger: { color: Colors.error },
});
