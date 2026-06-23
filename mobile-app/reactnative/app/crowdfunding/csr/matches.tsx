import React from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMatches, useApproveMatch } from '@/features/crowdfunding/hooks/useCsr';
import { formatNaira, progressPct } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { CsrMatchStatus } from '@/features/crowdfunding/types/csr.types';

const META: Record<CsrMatchStatus, { label: string; fg: string; bg: string }> = {
  DRAFT: { label: 'Draft', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  PENDING_APPROVAL: { label: 'Pending approval', fg: '#B65A00', bg: Colors.iconBgOrange },
  ACTIVE: { label: 'Active', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  COMPLETED: { label: 'Completed', fg: Colors.secondary, bg: Colors.iconBgBlue },
  PAUSED: { label: 'Paused', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

export default function MatchesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useMatches();
  const approve = useApproveMatch();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My matches" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load matches" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const meta = META[item.status];
            const pct = progressPct(item.matchedKobo, item.capKobo);
            return (
              <View style={styles.card}>
                <View style={styles.head}>
                  <Text style={styles.title} numberOfLines={1}>{item.campaignTitle}</Text>
                  <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
                <Text style={styles.meta}>{item.ratio} match · {item.visibility === 'ANONYMOUS' ? 'Anonymous' : 'Public'}</Text>
                <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
                <Text style={styles.amounts}>{formatNaira(item.matchedKobo)} matched of {formatNaira(item.capKobo)} cap</Text>
                {item.status === 'PENDING_APPROVAL' && (
                  <View style={styles.approveWrap}>
                    <PrimaryButton label="Approve match" onPress={() => approve.mutate(item.id)} loading={approve.isPending} />
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<StateView kind="empty" icon="HandCoins" title="No matches yet" message="Match a campaign to multiply contributions." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 60, flexGrow: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginTop: 2 },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  amounts: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  approveWrap: { marginTop: Spacing.sm },
});
