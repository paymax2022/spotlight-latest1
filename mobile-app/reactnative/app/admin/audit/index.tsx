// ── Paymax · Admin Console — Audit log ───────────────────────────────────────
// Newest-first action history, searchable by actor or action.

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import { AdminHeader, ListCard, AuditRow } from '@/features/admin/components';
import { useAudit } from '@/features/admin/hooks/useAdmin';

export default function AdminAuditScreen() {
  const audit = useAudit();
  const [query, setQuery] = useState('');

  // Hook already returns newest-first; keep that ordering.
  const list = audit.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.actor.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        e.entityId.toLowerCase().includes(q),
    );
  }, [list, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Audit Log" subtitle="Action history" />

      <SearchBar placeholder="Search actor or action" value={query} onChangeText={setQuery} />

      {audit.isLoading ? (
        <StateView kind="loading" message="Loading audit log…" />
      ) : audit.isError ? (
        <StateView
          kind="error"
          title="Couldn't load the audit log"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => audit.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="ScrollText" title="No activity yet" message="Admin actions will be recorded here." />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No matches" message={`No entries match "${query}".`} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={audit.isRefetching} onRefresh={() => audit.refetch()} tintColor={Colors.primary} />
          }
        >
          <ListCard flush>
            {filtered.map((e, i, arr) => (
              <AuditRow key={e.id} entry={e} last={i === arr.length - 1} />
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
