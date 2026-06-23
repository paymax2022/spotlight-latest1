import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Siren, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { KIND_META, STATUS_META } from '@/features/emergencies/api';
import { useEmergencies, useResolveEmergency } from '@/features/emergencies/hooks';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { EmergencyAlert } from '@/features/emergencies/api';

export default function EmergenciesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useEmergencies();
  const resolve = useResolveEmergency();

  const onResolve = (a: EmergencyAlert) => Alert.alert('Mark resolved?', `Close the ${KIND_META[a.kind].label.toLowerCase()} alert.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Resolve', onPress: () => resolve.mutate(a.id) },
  ]);

  const renderItem = ({ item }: { item: EmergencyAlert }) => {
    const meta = KIND_META[item.kind]; const sc = STATUS_META[item.status];
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.TriangleAlert;
    return (
      <View style={styles.card}>
        <View style={styles.iconBox}><Icon size={20} color={Colors.error} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={1}>{meta.label}{item.location ? ` · ${item.location}` : ''}</Text>
            <View style={[styles.chip, { backgroundColor: sc.bg }]}><Text style={[styles.chipText, { color: sc.color }]}>{sc.label}</Text></View>
          </View>
          {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
          <Text style={styles.meta}>{item.reporterName ?? 'Resident'} · {relativeTime(item.createdAt)}</Text>
        </View>
        {item.status !== 'resolved' ? (
          <Pressable onPress={() => onResolve(item)} accessibilityRole="button" accessibilityLabel="Resolve" hitSlop={8} style={styles.resolveBtn}><CheckCircle2 size={18} color={Colors.teal} strokeWidth={1.8} /></Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Emergencies" />
      <Pressable onPress={() => router.push('/emergencies/report')} accessibilityRole="button" style={({ pressed }) => [styles.panic, pressed && { opacity: 0.9 }]}>
        <Siren size={24} color={Colors.onError} strokeWidth={2} />
        <View style={{ flex: 1 }}><Text style={styles.panicTitle}>Report an emergency</Text><Text style={styles.panicSub}>Alert estate security & admin now</Text></View>
      </Pressable>
      {isLoading ? <StateView kind="loading" message="Loading alerts…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={data ?? []} keyExtractor={(a) => a.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="ShieldCheck" title="No active alerts" message="All clear. Reported emergencies appear here." />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  panic: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.error, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, ...shadow1 },
  panicTitle: { ...Typography.labelLg, color: Colors.onError },
  panicSub: { ...Typography.bodySm, color: Colors.errorContainer },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.labelSm, color: Colors.outline },
  resolveBtn: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
});
