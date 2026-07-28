import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Zap, Coins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useXpHistory } from '@/features/connect/gamification/hooks';
import type { XpHistoryEntry } from '@/features/connect/gamification/types';

/** XP & coin history (PRD §10.10). NON-CASH ledger of points — never money. */
export default function XpHistoryScreen() {
  const q = useXpHistory();

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function signed(n: number) {
    return n > 0 ? `+${n}` : `${n}`;
  }

  function renderItem({ item }: { item: XpHistoryEntry }) {
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.source}>{item.source}</Text>
          <Text style={styles.date}>{fmtDate(item.atIso)}</Text>
        </View>
        <View style={styles.deltas}>
          {item.xp !== 0 ? (
            <View style={styles.delta}>
              <Zap size={12} color={item.xp >= 0 ? ConnectColors.ok : Colors.error} strokeWidth={2.2} />
              <Text style={[styles.deltaText, item.xp < 0 && styles.deltaNeg]}>{signed(item.xp)} XP</Text>
            </View>
          ) : null}
          {item.coins !== 0 ? (
            <View style={styles.delta}>
              <Coins size={12} color={item.coins >= 0 ? ConnectColors.ok : Colors.error} strokeWidth={2.2} />
              <Text style={[styles.deltaText, item.coins < 0 && styles.deltaNeg]}>{signed(item.coins)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="XP & coin history" subtitle="Non-cash activity log" />
      {q.isLoading ? (
        <StateView kind="loading" message="Loading history…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load history" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Zap" title="No activity yet" message="Earn XP and coins by using Connect." />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(h) => h.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<View style={{ marginBottom: Spacing.sm }}><GameNonCashNotice compact message="This log tracks XP and coins only. These are not money and never appear in your wallet." /></View>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  source: { ...Typography.labelLg, color: Colors.onSurface },
  date: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  deltas: { alignItems: 'flex-end', gap: 3 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deltaText: { ...Typography.labelMd, color: ConnectColors.ok, fontWeight: '700' as const },
  deltaNeg: { color: Colors.error },
});
