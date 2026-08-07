import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { LogOut } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCheckOutVisit, useGateSession, useOpenVisits } from '@/features/visitor/hooks/useVisitor';
import { codeTypeMeta } from '@/features/visitor/constants/visitor.constants';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import type { OpenVisit } from '@/features/visitor/types/visitor.types';

export default function CheckOutScreen() {
  const session = useGateSession();
  const { data, isLoading, isError, refetch, isRefetching } = useOpenVisits();
  const checkout = useCheckOutVisit();

  const gateId = session.data?.gateId ?? 'gate_main';

  const onCheckOut = async (v: OpenVisit) => {
    const ok = await confirmAsync({ title: 'Check out visitor?', message: `Close ${v.visitorName}'s visit to ${v.unitLabel}.`, confirmLabel: 'Check out' });
    if (!ok) return;
    checkout.mutate({ visitEventId: v.visitEventId, gateId }, { onError: () => alertAsync({ title: 'Error', message: 'Could not check out the visitor.' }) });
  };

  const renderItem = ({ item }: { item: OpenVisit }) => {
    const meta = item.codeType ? codeTypeMeta(item.codeType) : null;
    const Icon = meta ? ((Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.UserRound) : Icons.UserRound;
    const accent = meta?.accent ?? Colors.secondary;
    const bg = meta?.bg ?? Colors.iconBgBlue;
    return (
      <View style={styles.card}>
        <View style={[styles.iconBox, { backgroundColor: bg }]}>
          <Icon size={20} color={accent} strokeWidth={1.8} />
        </View>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{item.visitorName}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {item.unitLabel} · in {relativeTime(item.checkedInAt)}
            {item.partySize && item.partySize > 1 ? ` · ${item.partySize} guests` : ''}
            {item.capturedPlate ? ` · ${item.capturedPlate}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => onCheckOut(item)}
          accessibilityRole="button"
          accessibilityLabel={`Check out ${item.visitorName}`}
          disabled={checkout.isPending}
          style={({ pressed }) => [styles.outBtn, pressed && { opacity: 0.85 }]}
        >
          <LogOut size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.outText}>Out</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Open visits" subtitle="Currently inside" />

      {isLoading ? (
        <StateView kind="loading" message="Loading open visits…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load visits" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
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
          ListEmptyComponent={
            <StateView kind="empty" icon="DoorClosed" title="No one inside" message="All visitors have checked out." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1,
  },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  outBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44,
    paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue,
  },
  outText: { ...Typography.labelMd, color: Colors.secondary },
});
