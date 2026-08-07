import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TimerOff, LogOut, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { VisitorColors } from '@/features/visitor/constants/visitor.constants';
import { useCheckOutVisit, useGateSession, useOverstays } from '@/features/visitor/hooks/useVisitor';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import type { OverstayVisit } from '@/features/visitor/types/visitor.types';

function overdueLabel(mins: number): string {
  if (mins < 60) return `${mins}m over`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m over`;
}

export default function OverstayScreen() {
  const session = useGateSession();
  const { data, isLoading, isError, refetch, isRefetching } = useOverstays();
  const checkout = useCheckOutVisit();

  const gateId = session.data?.gateId ?? 'gate_main';

  const onCheckOut = async (v: OverstayVisit) => {
    const ok = await confirmAsync({ title: 'Check out visitor?', message: `Close ${v.visitorName}'s overdue visit to ${v.unitLabel}.`, confirmLabel: 'Check out' });
    if (!ok) return;
    checkout.mutate({ visitEventId: v.visitEventId, gateId }, { onError: () => alertAsync({ title: 'Error', message: 'Could not check out.' }) });
  };

  const renderItem = ({ item }: { item: OverstayVisit }) => (
    <View style={styles.card}>
      <View style={styles.iconBox}><TimerOff size={20} color={VisitorColors.warning} strokeWidth={1.8} /></View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{item.visitorName}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.unitLabel} · in {relativeTime(item.checkedInAt)}
          {item.partySize && item.partySize > 1 ? ` · ${item.partySize} guests` : ''}
        </Text>
        <View style={styles.overduePill}>
          <Text style={styles.overdueText}>{overdueLabel(item.overdueByMinutes)}</Text>
        </View>
      </View>
      <Pressable onPress={() => onCheckOut(item)} accessibilityRole="button" accessibilityLabel={`Check out ${item.visitorName}`} disabled={checkout.isPending} style={({ pressed }) => [styles.outBtn, pressed && { opacity: 0.85 }]}>
        <LogOut size={16} color={Colors.secondary} strokeWidth={2} />
        <Text style={styles.outText}>Out</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Overstays" subtitle="Past expected duration" />
      {isLoading ? (
        <StateView kind="loading" message="Checking durations…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(v) => v.visitEventId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Users size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
              <Text style={styles.summaryText}>{(data?.length ?? 0)} visitor{(data?.length ?? 0) === 1 ? '' : 's'} past their expected exit time.</Text>
            </View>
          }
          ListEmptyComponent={<StateView kind="empty" icon="CircleCheck" title="No overstays" message="Everyone inside is within their expected time." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, marginBottom: Spacing.xs },
  summaryText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: VisitorColors.warningBg, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  overduePill: { alignSelf: 'flex-start', backgroundColor: VisitorColors.warningBg, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  overdueText: { ...Typography.labelSm, color: VisitorColors.warning, fontWeight: '700' },
  outBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue },
  outText: { ...Typography.labelMd, color: Colors.secondary },
});
