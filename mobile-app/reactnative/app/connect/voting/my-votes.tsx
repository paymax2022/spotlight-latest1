import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet, Vote } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useVoteHistory } from '@/features/connect/voting/hooks';
import type { VoteHistoryEntry } from '@/features/connect/voting/types';

/** My vote history & spend (PRD §10.8 VT-08). */
export default function MyVotesScreen() {
  const q = useVoteHistory();
  const history = q.data ?? [];
  const totalSpend = history.reduce((s, h) => s + h.amountKobo, 0);

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  }

  function renderItem({ item }: { item: VoteHistoryEntry }) {
    const paid = item.mode === 'paid';
    return (
      <View style={styles.row}>
        <View style={[styles.icon, paid ? styles.iconPaid : styles.iconFree]}>
          {paid ? <Wallet size={16} color={Colors.onPrimary} strokeWidth={2.2} /> : <Vote size={16} color={Colors.onPrimary} strokeWidth={2.2} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.contest} numberOfLines={1}>{item.contestTitle}</Text>
          <Text style={styles.detail}>{item.votes} {item.votes === 1 ? 'vote' : 'votes'} for {item.contestantName} · {fmtDate(item.castAtIso)}</Text>
        </View>
        <Text style={[styles.amount, !paid && styles.amountFree]}>{paid ? formatKobo(item.amountKobo) : 'Free'}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My votes" subtitle="History & spend" />
      {q.isLoading ? (
        <StateView kind="loading" message="Loading your votes…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load history" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : history.length === 0 ? (
        <StateView kind="empty" icon="Vote" title="No votes yet" message="Votes you cast will show up here." />
      ) : (
        <FlatList
          data={history}
          keyExtractor={(h) => h.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>Total spent on paid votes</Text>
              <Text style={styles.summaryValue}>{formatKobo(totalSpend)}</Text>
              <Text style={styles.summarySub}>Real money from your wallet. Free votes cost nothing.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  summary: { backgroundColor: ConnectColors.brand, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.md, gap: 2 },
  summaryLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  summaryValue: { ...Typography.displayLg, color: Colors.onPrimary, fontWeight: '800' as const },
  summarySub: { ...Typography.caption, color: Colors.inversePrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  iconPaid: { backgroundColor: ConnectColors.brand },
  iconFree: { backgroundColor: ConnectColors.ok },
  contest: { ...Typography.labelLg, color: Colors.onSurface },
  detail: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  amount: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  amountFree: { color: ConnectColors.ok },
});
