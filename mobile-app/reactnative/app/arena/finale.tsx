import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Radio, Trophy, HeartHandshake, PlayCircle, QrCode, HandCoins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import QrCodeView from '@/components/QrCodeView';
import { useCompetition, useMeritLeaderboard } from '@/features/arena/hooks';
import SupportSheet from '@/features/arena/components/SupportSheet';
import { formatNaira, NDC1_SUPPORT_NOTE } from '@/features/arena/constants';

/**
 * S8 — Live finale stream + live gifting. The player is STUBBED for sandbox (see
 * the placeholder below; real low-latency player plugs into <StreamPlayer/>). A
 * live Merit reveal overlay shows the current top-3 (the real ranking), and a
 * People's Champion ticker shows support totals — clearly separate from Merit.
 * Finalists also get a check-in QR stub.
 */
export default function FinaleScreen() {
  const { competitionId: raw, finalist } = useLocalSearchParams<{ competitionId?: string; finalist?: string }>();
  const competitionId = raw ?? '';
  const isFinalist = finalist === '1';
  const comp = useCompetition(competitionId);
  const board = useMeritLeaderboard(competitionId, 10_000); // poll for live reveal
  const [sheetFor, setSheetFor] = useState<{ id: string; name: string } | null>(null);

  const top = (board.data ?? []).slice(0, 3);
  const ticker = (board.data ?? []).slice(0, 6);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Live Finale" subtitle={comp.data?.title} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* ── STREAM PLAYER (STUBBED) ──────────────────────────────────────────
            Real integration: mount the low-latency player with the server-issued
            stream URL/token (no secret in app). Gate PPV/free per competition config.
        */}
        <View style={styles.player}>
          <View style={styles.liveBadge}><Radio size={12} color={Colors.onPrimary} /><Text style={styles.liveText}>LIVE</Text></View>
          <PlayCircle size={56} color={Colors.onPrimary} />
          <Text style={styles.playerStub}>Finale stream (sandbox placeholder)</Text>
          <Text style={styles.playerHint}>The live player mounts here in production.</Text>
        </View>

        {/* Live Merit reveal overlay (the real ranking) */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardHead}><Trophy size={18} color={Colors.gold} /><Text style={styles.cardTitle}>Live Merit reveal</Text></View>
          {board.isLoading ? (
            <StateView kind="loading" compact />
          ) : top.length === 0 ? (
            <Text style={styles.muted}>Scores appear as the finale progresses.</Text>
          ) : (
            top.map((e) => (
              <View key={e.contestantId} style={styles.revealRow}>
                <Text style={[styles.revealRank, e.rank === 1 && styles.revealRankTop]}>{e.rank}</Text>
                <Text style={styles.revealName} numberOfLines={1}>{e.displayName}</Text>
                <Text style={styles.revealPts}>{e.meritPoints} Merit</Text>
              </View>
            ))
          )}
        </View>

        {/* People's Champion ticker + live gifting */}
        <View style={[styles.card, styles.pcCard]}>
          <View style={styles.cardHead}><HeartHandshake size={18} color={Colors.secondary} /><Text style={styles.cardTitle}>People’s Champion · live gifting</Text></View>
          <Text style={styles.muted}>{NDC1_SUPPORT_NOTE}</Text>
          {ticker.map((e) => (
            <View key={e.contestantId} style={styles.tickerRow}>
              <Text style={styles.tickerName} numberOfLines={1}>{e.displayName}</Text>
              <Pressable style={styles.giftBtn} onPress={() => setSheetFor({ id: e.contestantId, name: e.displayName })}>
                <HandCoins size={14} color={Colors.onPrimary} />
                <Text style={styles.giftText}>Gift</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {isFinalist ? (
          <View style={[styles.card, shadow1]}>
            <View style={styles.cardHead}><QrCode size={18} color={Colors.primary} /><Text style={styles.cardTitle}>Your finale check-in</Text></View>
            <View style={{ alignItems: 'center', marginTop: Spacing.sm }}>
              <QrCodeView payload={`checkin:${competitionId}`} size={150} />
              <Text style={styles.muted}>Show this QR at the venue to check in (sandbox stub).</Text>
            </View>
          </View>
        ) : null}

        <PrimaryButton label="Prize pot transparency" variant="secondary" onPress={() => router.push({ pathname: '/arena/pot', params: { competitionId } })} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>

      {sheetFor ? (
        <SupportSheet
          visible={!!sheetFor}
          onClose={() => setSheetFor(null)}
          competitionId={competitionId}
          contestantId={sheetFor.id}
          driverName={sheetFor.name}
          onSupported={() => board.refetch()}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  player: { backgroundColor: Colors.backdropDark, borderRadius: Radius.xl, minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  liveBadge: { position: 'absolute', top: Spacing.md, left: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.error, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  liveText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
  playerStub: { ...Typography.labelLg, color: Colors.onPrimary },
  playerHint: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  pcCard: { backgroundColor: Colors.surfaceContainerLow },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  muted: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  revealRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 6 },
  revealRank: { ...Typography.titleMd, color: Colors.onSurfaceVariant, width: 24, textAlign: 'center' },
  revealRankTop: { color: Colors.gold, fontWeight: '800' as const },
  revealName: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  revealPts: { ...Typography.labelMd, color: Colors.primary },
  tickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  tickerName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  giftBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.secondary, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  giftText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '600' as const },
});
