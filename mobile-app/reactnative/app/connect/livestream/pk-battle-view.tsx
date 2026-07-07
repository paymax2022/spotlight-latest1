import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Swords, Clock, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { usePkBattle } from '@/features/connect/livestream/hooks';

/** Split-screen PK battle progress (PRD §10.6 LV-05). Scores are gift-revenue (kobo). */
export default function PkBattleViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = usePkBattle(id ?? '');

  if (q.isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="PK battle" /><StateView kind="loading" message="Loading battle…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><ScreenHeader title="PK battle" /><StateView kind="error" title="Couldn't load battle" actionLabel="Retry" onAction={() => q.refetch()} /></SafeAreaView>;

  const b = q.data;
  const total = b.teamA.scoreKobo + b.teamB.scoreKobo || 1;
  const aPct = Math.round((b.teamA.scoreKobo / total) * 100);
  const bPct = 100 - aPct;
  const mins = Math.floor(b.remainingSec / 60);
  const secs = b.remainingSec % 60;
  const leading = b.teamA.scoreKobo >= b.teamB.scoreKobo ? 'A' : 'B';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="PK battle" subtitle="Live gifting scoreboard" />
      <View style={styles.body}>
        <View style={styles.timerRow}>
          <Clock size={15} color={ConnectColors.brand} strokeWidth={2.2} />
          <Text style={styles.timer}>{b.state === 'ended' ? 'Ended' : `${mins}:${secs.toString().padStart(2, '0')} left`}</Text>
        </View>

        <View style={styles.teams}>
          {[b.teamA, b.teamB].map((t, i) => {
            const isLead = (i === 0 ? 'A' : 'B') === leading;
            return (
              <View key={t.hostId} style={[styles.teamCard, isLead && styles.teamLead]}>
                <Image source={{ uri: t.hostAvatar }} style={styles.avatar} />
                <Text style={styles.teamName} numberOfLines={1}>{t.hostName}</Text>
                <Text style={styles.score}>{formatKobo(t.scoreKobo)}</Text>
                {t.topGifter ? <Text style={styles.topGifter}>Top: {t.topGifter}</Text> : null}
              </View>
            );
          })}
          <View style={styles.vs}><Swords size={20} color={Colors.onPrimary} strokeWidth={2.4} /></View>
        </View>

        <View style={styles.barTrack}>
          <View style={[styles.barA, { flex: aPct }]} />
          <View style={[styles.barB, { flex: bPct }]} />
        </View>
        <View style={styles.pctRow}>
          <Text style={styles.pctA}>{aPct}%</Text>
          <Text style={styles.pctB}>{bPct}%</Text>
        </View>

        <View style={styles.note}>
          <Gift size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>
            Scores reflect real gifts (Naira) sent to each side. Gifting is wallet money — your tier limit applies.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.lg },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', backgroundColor: Colors.iconBgPurple, paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full },
  timer: { ...Typography.labelLg, color: ConnectColors.brand, fontWeight: '700' as const },
  teams: { flexDirection: 'row', gap: Spacing.md, position: 'relative' },
  teamCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: ConnectColors.border, padding: Spacing.md, alignItems: 'center', gap: 4 },
  teamLead: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.surfaceContainer },
  teamName: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  score: { ...Typography.titleMd, color: ConnectColors.brand },
  topGifter: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  vs: { position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: ConnectColors.accent, alignItems: 'center', justifyContent: 'center' },
  barTrack: { flexDirection: 'row', height: 14, borderRadius: Radius.full, overflow: 'hidden', backgroundColor: Colors.surfaceContainerHigh },
  barA: { backgroundColor: ConnectColors.brand },
  barB: { backgroundColor: ConnectColors.accent },
  pctRow: { flexDirection: 'row', justifyContent: 'space-between' },
  pctA: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' as const },
  pctB: { ...Typography.labelMd, color: ConnectColors.accent, fontWeight: '700' as const },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  noteText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 17 },
});
