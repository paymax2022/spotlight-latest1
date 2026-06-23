import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import AccessCodeCard from '@/features/visitor/components/AccessCodeCard';
import { useExpectedVisitors } from '@/features/visitor/hooks/useVisitor';
import type { AccessCode } from '@/features/visitor/types/visitor.types';

export default function ExpectedVisitorsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useExpectedVisitors();

  const renderItem = ({ item }: { item: AccessCode }) => (
    <AccessCodeCard code={item} onPress={() => router.push(`/guard/confirm/${item.codeValue}`)} />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Expected visitors" subtitle="Valid codes for today" />

      {isLoading ? (
        <StateView kind="loading" message="Loading expected visitors…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load list" message="Pull to refresh or retry." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={
            <StateView kind="empty" icon="Users" title="No expected visitors" message="When residents create codes, they'll appear here for quick verification." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
});
