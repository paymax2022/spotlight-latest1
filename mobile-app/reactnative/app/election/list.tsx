import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Vote, ChevronRight, Settings2, Users, Eye } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ElectionColors, ELECTION_STATUS_LABELS } from '@/features/election/constants/election.constants';
import { countdownLabel, derivedStatus } from '@/features/election/utils/electionFormatters';
import { useElections } from '@/features/election/hooks/useElection';
import type { Election, ElectionStatus } from '@/features/election/types/election.types';

function chipColors(status: ElectionStatus) {
  if (status === 'live') return { color: ElectionColors.live, bg: ElectionColors.liveBg };
  if (status === 'scheduled') return { color: ElectionColors.scheduled, bg: ElectionColors.scheduledBg };
  return { color: ElectionColors.closed, bg: ElectionColors.closedBg };
}

export default function ElectionListScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useElections();

  const renderItem = ({ item }: { item: Election }) => {
    const status = derivedStatus(item);
    const c = chipColors(status);
    return (
      <Pressable onPress={() => router.push(`/election?id=${item.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.iconBox}><Vote size={20} color={Colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: c.bg }]}>
              {status === 'live' ? <View style={[styles.chipDot, { backgroundColor: c.color }]} /> : null}
              <Text style={[styles.chipText, { color: c.color }]}>{ELECTION_STATUS_LABELS[status]}</Text>
            </View>
            <Text style={styles.sub} numberOfLines={1}>{countdownLabel(item)}</Text>
          </View>
          <View style={styles.turnoutRow}>
            <Users size={12} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.turnout}>{item.votesCast}/{item.totalEligibleVoters} voted</Text>
          </View>
        </View>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Elections"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/election/observer')} accessibilityRole="button" accessibilityLabel="Observer view" hitSlop={8} style={styles.manageBtn}>
              <Eye size={20} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            </Pressable>
            <Pressable onPress={() => router.push('/election/admin/setup')} accessibilityRole="button" accessibilityLabel="Create election (admin)" hitSlop={8} style={styles.manageBtn}>
              <Settings2 size={20} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            </Pressable>
          </View>
        }
      />
      {isLoading ? (
        <StateView kind="loading" message="Loading elections…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load elections" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={<StateView kind="empty" icon="Vote" title="No elections" message="Estate elections will appear here." actionLabel="Create one" onAction={() => router.push('/election/admin/setup')} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  manageBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  turnoutRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  turnout: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
