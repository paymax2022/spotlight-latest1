import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MeetingCard from '@/features/meetings/components/MeetingCard';
import { useMeetings } from '@/features/meetings/hooks/useMeetings';
import { isUpcoming } from '@/features/meetings/utils/meetingsFormatters';
import type { Meeting } from '@/features/meetings/types/meetings.types';

type Tab = 'upcoming' | 'past';

export default function MeetingsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useMeetings();
  const [tab, setTab] = useState<Tab>('upcoming');

  const filtered = useMemo(() => {
    const list = data ?? [];
    return list.filter((m) => (tab === 'upcoming' ? isUpcoming(m) : !isUpcoming(m)));
  }, [data, tab]);

  const renderItem = ({ item }: { item: Meeting }) => (
    <MeetingCard meeting={item} onPress={() => router.push(`/meetings/${item.id}`)} />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Meetings"
        rightSlot={
          <Pressable onPress={() => router.push('/meetings/create')} accessibilityRole="button" accessibilityLabel="Schedule meeting" hitSlop={8} style={styles.addBtn}>
            <Plus size={22} color={Colors.secondary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      <View style={styles.segment}>
        {(['upcoming', 'past'] as Tab[]).map((t) => {
          const selected = t === tab;
          return (
            <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.segItem, selected && styles.segItemSelected]}>
              <Text style={[styles.segText, selected && styles.segTextSelected]}>{t === 'upcoming' ? 'Upcoming' : 'Past'}</Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading meetings…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load meetings" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="CalendarDays"
              title={tab === 'upcoming' ? 'No upcoming meetings' : 'No past meetings'}
              message={tab === 'upcoming' ? 'Schedule one for your estate.' : 'Past meetings will appear here.'}
              actionLabel={tab === 'upcoming' ? 'Schedule meeting' : undefined}
              onAction={tab === 'upcoming' ? () => router.push('/meetings/create') : undefined}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: 4, gap: 4 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.DEFAULT },
  segItemSelected: { backgroundColor: Colors.surfaceContainerLowest },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  segTextSelected: { color: Colors.primary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
});
