import React, { useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import MemberRow from '@/features/association/components/MemberRow';
import { useDirectory } from '@/features/association/hooks/useAssociation';
import { DIRECTORY_STATUS_SEGMENTS } from '@/features/association/constants/association.constants';
import type { MemberStatus } from '@/features/association/types/association.types';

export default function MemberDirectory() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');

  const members = useDirectory({
    search: search || undefined,
    status: status === 'all' ? undefined : (status as MemberStatus),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Member directory" />

      <View style={styles.searchWrap}>
        <SearchBar placeholder="Search by name or member ID…" value={search} onChangeText={setSearch} />
      </View>
      <View style={styles.segWrap}>
        <SegmentedControl options={DIRECTORY_STATUS_SEGMENTS as never} value={status} onChange={setStatus} />
      </View>

      {members.isLoading ? (
        <StateView kind="loading" message="Loading members…" />
      ) : members.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => members.refetch()} />
      ) : (members.data?.length ?? 0) === 0 ? (
        <StateView
          kind="empty"
          icon="Users"
          title="No members found"
          message={search ? `Nothing matches “${search}”.` : 'No members match this filter.'}
        />
      ) : (
        <FlatList
          data={members.data ?? []}
          keyExtractor={(m) => m.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <MemberRow member={item} onPress={() => router.push(`/association/member/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { marginTop: Spacing.sm, marginBottom: Spacing.sm },
  segWrap: { marginBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  sep: { height: 1, backgroundColor: Colors.outlineVariant, opacity: 0.5 },
});
