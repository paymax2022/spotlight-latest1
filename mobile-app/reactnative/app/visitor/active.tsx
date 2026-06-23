import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import AccessCodeCard from '@/features/visitor/components/AccessCodeCard';
import { useAccessCodes } from '@/features/visitor/hooks/useVisitor';
import { effectiveStatus } from '@/features/visitor/utils/visitorFormatters';
import type { AccessCode } from '@/features/visitor/types/visitor.types';

type Filter = 'active' | 'expired' | 'revoked';
const TABS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'expired', label: 'Expired' },
  { key: 'revoked', label: 'Revoked' },
];

export default function ActiveCodesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useAccessCodes();
  const [filter, setFilter] = useState<Filter>('active');

  const filtered = useMemo(() => {
    const codes = data ?? [];
    return codes.filter((c) => {
      const s = effectiveStatus(c);
      if (filter === 'active') return s === 'active';
      if (filter === 'expired') return s === 'expired' || s === 'used';
      return s === 'revoked';
    });
  }, [data, filter]);

  const renderItem = ({ item }: { item: AccessCode }) => (
    <AccessCodeCard code={item} onPress={() => router.push(`/visitor/code/${item.id}`)} />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My access codes" />

      {/* Segmented control */}
      <View style={styles.segment}>
        {TABS.map((t) => {
          const selected = t.key === filter;
          return (
            <Pressable
              key={t.key}
              onPress={() => setFilter(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.segmentItem, selected && styles.segmentItemSelected]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading codes…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load codes" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Ticket"
              title={`No ${filter} codes`}
              message={filter === 'active' ? 'Invite a visitor to create one.' : `You have no ${filter} codes.`}
              actionLabel={filter === 'active' ? 'Invite visitor' : undefined}
              onAction={filter === 'active' ? () => router.push('/visitor/create') : undefined}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segment: {
    flexDirection: 'row',
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.DEFAULT },
  segmentItemSelected: { backgroundColor: Colors.surfaceContainerLowest },
  segmentText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  segmentTextSelected: { color: Colors.primary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
});
