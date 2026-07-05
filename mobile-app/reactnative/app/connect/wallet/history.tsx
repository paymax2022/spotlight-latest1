import React from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import WalletEntryRow from '@/features/connect/components/wallet-WalletEntryRow';
import type { WalletEntry } from '@/features/connect/wallet/types';
import { useWalletHistory } from '@/features/connect/wallet/hooks';

// WL-03 — Ledger-style wallet history (every money move, signed).
export default function WalletHistory() {
  const { data, isLoading, error, refetch, isRefetching } = useWalletHistory();
  const entries = data?.entries ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="History" subtitle="Every money movement" />
      {isLoading ? (
        <StateView kind="loading" message="Loading history…" />
      ) : error ? (
        <StateView kind="error" title="Couldn't load history" actionLabel="Retry" onAction={() => refetch()} />
      ) : entries.length === 0 ? (
        <StateView kind="empty" icon="Receipt" title="No transactions yet"
          message="Your wallet activity will appear here." />
      ) : (
        <FlatList<WalletEntry>
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <WalletEntryRow entry={item}
              onPress={() => router.push({ pathname: '/connect/wallet/transaction-detail', params: { id: item.id } })} />
          )}
          ListFooterComponent={<Text style={styles.footer}>Showing your most recent activity</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40 },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  footer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.lg },
});
