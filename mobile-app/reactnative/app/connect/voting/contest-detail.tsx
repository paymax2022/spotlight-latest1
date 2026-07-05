import React from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Trophy, ShieldCheck, ChevronRight, Wallet, Vote } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useContest } from '@/features/connect/voting/hooks';
import type { Contestant } from '@/features/connect/voting/types';

/** Contest detail (PRD §10.8 VT-02): rules, contestants, prize info, integrity note. */
export default function ContestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contestId = id ?? '';
  const q = useContest(contestId);

  if (q.isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Contest" /><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><ScreenHeader title="Contest" /><StateView kind="error" title="Couldn't load contest" actionLabel="Retry" onAction={() => q.refetch()} /></SafeAreaView>;
  const c = q.data;

  function voteFor(ct: Contestant) {
    if (c.status !== 'active') return;
    const route = c.mode === 'paid' ? '/connect/voting/paid-vote' : '/connect/voting/vote-modal';
    router.push({ pathname: route, params: { contestId, contestantId: ct.id, name: ct.name } });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={c.title} subtitle={c.subtitle} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: c.coverUrl }} style={styles.cover} resizeMode="cover" />

        <View style={styles.tagRow}>
          <View style={[styles.tag, c.mode === 'paid' ? styles.paidTag : styles.freeTag]}>
            {c.mode === 'paid' ? <Wallet size={12} color={Colors.onPrimary} strokeWidth={2.2} /> : <Vote size={12} color={Colors.onPrimary} strokeWidth={2.2} />}
            <Text style={styles.tagText}>{c.mode === 'paid' ? `${formatKobo(c.pricePerVoteKobo)} per vote` : 'Free voting'}</Text>
          </View>
          <Pressable style={styles.resultsLink} onPress={() => router.push({ pathname: '/connect/voting/results', params: { id: contestId } })}>
            <Trophy size={14} color={Colors.secondary} strokeWidth={2.2} />
            <Text style={styles.resultsText}>Live results</Text>
          </Pressable>
        </View>

        {c.prizeInfo ? (
          <View style={styles.prizeBox}>
            <Text style={styles.prizeTitle}>Prize</Text>
            <Text style={styles.prizeText}>{c.prizeInfo}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Rules</Text>
        <View style={styles.rulesBox}>
          {c.rules.map((r, i) => <Text key={i} style={styles.rule}>• {r}</Text>)}
        </View>

        {/* Integrity / anti-gambling note (PRD §6.3) */}
        <View style={styles.integrity}>
          <ShieldCheck size={15} color={ConnectColors.ok} strokeWidth={2.2} />
          <Text style={styles.integrityText}>
            Results are auditable and protected against bots and vote-buying. Voters never receive money or prizes — this is not a game of chance.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Contestants</Text>
        {c.contestants.map((ct) => (
          <Pressable key={ct.id} style={styles.ctRow} onPress={() => voteFor(ct)} accessibilityRole="button" accessibilityLabel={`Vote for ${ct.name}`}>
            <Text style={styles.ctRank}>{ct.rank}</Text>
            <Image source={{ uri: ct.avatar }} style={styles.ctAvatar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.ctName}>{ct.name}</Text>
              <View style={styles.ctBarTrack}><View style={[styles.ctBarFill, { width: `${ct.sharePct}%` }]} /></View>
              <Text style={styles.ctVotes}>{ct.votes.toLocaleString('en-NG')} votes · {ct.sharePct}%</Text>
            </View>
            {c.status === 'active' ? <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : null}
          </Pressable>
        ))}
      </ScrollView>

      {c.status === 'active' ? (
        <View style={styles.footer}>
          <PrimaryButton
            label={c.mode === 'paid' ? 'Cast a paid vote' : 'Vote for free'}
            onPress={() => voteFor(c.contestants[0])}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.lg },
  cover: { width: '100%', aspectRatio: 1.8, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainer },
  tagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full },
  paidTag: { backgroundColor: ConnectColors.brand },
  freeTag: { backgroundColor: ConnectColors.ok },
  tagText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  resultsLink: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  resultsText: { ...Typography.labelMd, color: Colors.secondary },
  prizeBox: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md },
  prizeTitle: { ...Typography.labelLg, color: Colors.onWarning, fontWeight: '700' as const },
  prizeText: { ...Typography.bodySm, color: Colors.onWarning, marginTop: 2 },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rulesBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  rule: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
  integrity: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: ConnectColors.okBg, borderRadius: Radius.md, padding: Spacing.md },
  integrityText: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 17 },
  ctRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.sm },
  ctRank: { ...Typography.titleMd, color: ConnectColors.brand, width: 22, textAlign: 'center' },
  ctAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surfaceContainer },
  ctName: { ...Typography.labelLg, color: Colors.onSurface },
  ctBarTrack: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginVertical: 4 },
  ctBarFill: { height: '100%', borderRadius: Radius.full, backgroundColor: ConnectColors.brand },
  ctVotes: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border },
});
