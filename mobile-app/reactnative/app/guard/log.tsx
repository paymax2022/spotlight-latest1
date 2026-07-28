import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CloudUpload } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import VisitEventRow from '@/features/visitor/components/VisitEventRow';
import { VisitorColors } from '@/features/visitor/constants/visitor.constants';
import { useGateLog, usePendingSyncCount, useSyncPendingLogs } from '@/features/visitor/hooks/useVisitor';
import type { VisitEvent } from '@/features/visitor/types/visitor.types';

export default function GateLogScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useGateLog();
  const pending = usePendingSyncCount();
  const sync = useSyncPendingLogs();

  const pendingCount = pending.data ?? 0;

  const runSync = () => {
    sync.mutate(undefined, {
      onSuccess: (n) => Alert.alert('Sync complete', n > 0 ? `${n} pending log${n === 1 ? '' : 's'} synced.` : 'Nothing to sync.'),
      onError: () => Alert.alert('Sync failed', 'Will retry when connection is stable.'),
    });
  };

  const renderItem = ({ item }: { item: VisitEvent }) => (
    <View style={styles.rowWrap}><VisitEventRow event={item} /></View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Gate activity" subtitle="This shift" />

      {pendingCount > 0 ? (
        <Pressable onPress={runSync} accessibilityRole="button" style={styles.syncBanner}>
          <CloudUpload size={18} color={VisitorColors.warning} strokeWidth={2} />
          <Text style={styles.syncText}>
            {pendingCount} log{pendingCount === 1 ? '' : 's'} pending sync
          </Text>
          <Text style={styles.syncAction}>{sync.isPending ? 'Syncing…' : 'Sync now'}</Text>
        </Pressable>
      ) : null}

      {isLoading ? (
        <StateView kind="loading" message="Loading gate log…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load log" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={
            <StateView kind="empty" icon="ClipboardList" title="No activity yet" message="Entries and exits for this shift will show here." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  syncBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm,
    backgroundColor: VisitorColors.warningBg, borderRadius: Radius.md, padding: Spacing.md,
  },
  syncText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  syncAction: { ...Typography.labelMd, color: VisitorColors.warning, fontWeight: '700' },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  rowWrap: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md, marginBottom: Spacing.sm,
  },
});
