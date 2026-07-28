import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import VisitEventRow from '@/features/visitor/components/VisitEventRow';
import { useVisitHistory } from '@/features/visitor/hooks/useVisitor';
import type { VisitEvent } from '@/features/visitor/types/visitor.types';

export default function VisitorHistoryScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useVisitHistory();

  const renderItem = ({ item }: { item: VisitEvent }) => (
    <View style={styles.rowWrap}>
      <VisitEventRow event={item} />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Visitor history" />

      {isLoading ? (
        <StateView kind="loading" message="Loading history…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load history" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
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
            <StateView kind="empty" icon="History" title="No visitors yet" message="Your gate activity will appear here." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  rowWrap: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
});
