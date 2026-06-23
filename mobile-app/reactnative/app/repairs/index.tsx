import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Plus, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useRepairs } from '@/features/repairs/hooks';
import { CATEGORY_META, URGENCY_META, STATUS_META } from '@/features/repairs/api';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { RepairRequest } from '@/features/repairs/api';

export default function RepairsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useRepairs();

  const renderItem = ({ item }: { item: RepairRequest }) => {
    const cat = CATEGORY_META[item.category]; const ur = URGENCY_META[item.urgency]; const st = STATUS_META[item.status];
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[cat.icon] ?? Icons.Wrench;
    return (
      <Pressable onPress={() => router.push(`/repairs/${item.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.iconBox}><Icon size={20} color={Colors.secondary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={1}>{cat.label}</Text>
            <View style={[styles.chip, { backgroundColor: st.bg }]}><Text style={[styles.chipText, { color: st.color }]}>{st.label}</Text></View>
          </View>
          <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.tag, { backgroundColor: ur.bg }]}><Text style={[styles.tagText, { color: ur.color }]}>{ur.label}</Text></View>
            <Text style={styles.meta}>{item.reporterName ?? 'Resident'} · {relativeTime(item.createdAt)}</Text>
          </View>
        </View>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Maintenance" rightSlot={
        <Pressable onPress={() => router.push('/repairs/report')} accessibilityRole="button" accessibilityLabel="Report repair" hitSlop={8} style={styles.addBtn}><Plus size={22} color={Colors.secondary} strokeWidth={2.2} /></Pressable>
      } />
      {isLoading ? <StateView kind="loading" message="Loading requests…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={data ?? []} keyExtractor={(r) => r.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="Wrench" title="No requests yet" message="Report a maintenance issue in your estate." actionLabel="Report issue" onAction={() => router.push('/repairs/report')} />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  tag: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { ...Typography.labelSm, fontWeight: '700' },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  meta: { ...Typography.labelSm, color: Colors.outline },
});
