// ── Paymax · Admin Console — Users list ──────────────────────────────────────
// Searchable directory of users → drill into a profile detail.

import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import { AdminHeader, ListCard, DataRow, StatusPill } from '@/features/admin/components';
import { useAdminUsers } from '@/features/admin/hooks/useAdmin';
import { ENTITY_STATUS_STYLE } from '@/features/admin/constants/admin.constants';

export default function AdminUsersScreen() {
  const users = useAdminUsers();
  const [query, setQuery] = useState('');

  const list = users.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q),
    );
  }, [list, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Users" subtitle="Accounts & profiles" />

      <SearchBar placeholder="Search name, email or ID" value={query} onChangeText={setQuery} />

      {users.isLoading ? (
        <StateView kind="loading" message="Loading users…" />
      ) : users.isError ? (
        <StateView
          kind="error"
          title="Couldn't load users"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => users.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Users" title="No users yet" message="Registered users will appear here." />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No matches" message={`No users match "${query}".`} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={users.isRefetching} onRefresh={() => users.refetch()} tintColor={Colors.primary} />
          }
        >
          <ListCard flush>
            {filtered.map((u, i, arr) => (
              <DataRow
                key={u.id}
                label={u.name}
                sublabel={`${u.email} · Tier ${u.kycTier}`}
                onPress={() => router.push(`/admin/users/${u.id}`)}
                showChevron
                last={i === arr.length - 1}
                right={<StatusPill status={u.status} styleMap={ENTITY_STATUS_STYLE} />}
              />
            ))}
          </ListCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
});
