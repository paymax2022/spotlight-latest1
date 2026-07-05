import React, { useState } from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Vote, Clock, Users, Wallet, ListChecks } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useContests } from '@/features/connect/voting/hooks';
import type { Contest, ContestStatus } from '@/features/connect/voting/types';

/** Contests / polls list (PRD §10.8 VT-01). */
export default function ContestsScreen() {
  const [status, setStatus] = useState<ContestStatus>('active');
  const q = useContests(status);

  function timeLeft(iso: string) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'Ended';
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
  }

  function renderItem({ item }: { item: Contest }) {
    return (
      <Pressable
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
        onPress={() => router.push({ pathname: '/connect/voting/contest-detail', params: { id: item.id } })}
      >
        <Image source={{ uri: item.coverUrl }} style={styles.cover} resizeMode="cover" />
        <View style={[styles.modeBadge, item.mode === 'paid' ? styles.paidBadge : styles.freeBadge]}>
          {item.mode === 'paid' ? <Wallet size={11} color={Colors.onPrimary} strokeWidth={2.2} /> : <Vote size={11} color={Colors.onPrimary} strokeWidth={2.2} />}
          <Text style={styles.modeText}>{item.mode === 'paid' ? `Paid · ${formatKobo(item.pricePerVoteKobo)}/vote` : 'Free poll'}</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
          <View style={styles.metaRow}>
            <View style={styles.meta}><Users size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{item.contestantCount}</Text></View>
            <View style={styles.meta}><Vote size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{item.totalVotes.toLocaleString('en-NG')}</Text></View>
            <View style={styles.meta}><Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{timeLeft(item.endsAtIso)}</Text></View>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Contests & polls"
        subtitle="Vote for your favourites"
        rightSlot={
          <Pressable hitSlop={10} accessibilityLabel="My votes" onPress={() => router.push('/connect/voting/my-votes')}>
            <ListChecks size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <View style={styles.segWrap}>
        <SegmentedControl
          options={[{ value: 'active', label: 'Active' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'ended', label: 'Ended' }]}
          value={status}
          onChange={setStatus}
        />
      </View>

      {q.isLoading ? (
        <StateView kind="loading" message="Loading contests…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load contests" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Vote" title="Nothing here yet" message={`No ${status} contests right now.`} />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={Colors.primary} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingVertical: Spacing.sm },
  list: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, overflow: 'hidden' },
  cover: { width: '100%', aspectRatio: 1.8, backgroundColor: Colors.surfaceContainer },
  modeBadge: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  paidBadge: { backgroundColor: ConnectColors.brand },
  freeBadge: { backgroundColor: ConnectColors.ok },
  modeText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' as const, fontSize: 11 },
  body: { padding: Spacing.md, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  subtitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
