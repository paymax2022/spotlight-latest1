import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Play, Pause, RotateCcw, Captions } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useLiveSession } from '@/features/academy/hooks';
import { formatClock } from '@/features/academy/constants';

/** C3 — Replay player: recorded playback (mock player). */
export default function ReplayPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useLiveSession(id);
  const [playing, setPlaying] = React.useState(false);
  const [pct, setPct] = React.useState(0);

  React.useEffect(() => { if (session.data?.watchedPct != null) setPct(session.data.watchedPct); }, [session.data]);

  React.useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setPct((p) => (p >= 100 ? (clearInterval(t), 100) : p + 2)), 500);
    return () => clearInterval(t);
  }, [playing]);

  if (session.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading replay…" /></SafeAreaView>;
  if (session.isError || !session.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Unavailable" message="This replay could not be loaded." /></SafeAreaView>;

  const s = session.data;
  const totalSec = s.durationMin * 60;
  const posSec = Math.round((pct / 100) * totalSec);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={s.title} subtitle={`${s.subjectOrTrade} · ${s.host}`} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Video placeholder */}
        <View style={styles.stage}>
          {playing ? <Pause size={40} color={Colors.onPrimary} /> : <Play size={40} color={Colors.onPrimary} />}
          <Text style={styles.stageHint}>Recorded video placeholder</Text>
        </View>

        {/* Scrubber */}
        <View style={[styles.controls, shadow1]}>
          <ProgressBar pct={pct} />
          <View style={styles.timeRow}>
            <Text style={styles.time}>{formatClock(posSec)}</Text>
            <Text style={styles.time}>{formatClock(totalSec)}</Text>
          </View>
          <View style={styles.btnRow}>
            <Pressable style={styles.iconBtn} onPress={() => setPct((p) => Math.max(0, p - 10))}><RotateCcw size={20} color={Colors.onSurface} /></Pressable>
            <Pressable style={styles.playBtn} onPress={() => setPlaying((p) => !p)}>
              {playing ? <Pause size={24} color={Colors.onPrimary} /> : <Play size={24} color={Colors.onPrimary} />}
            </Pressable>
            <Pressable style={styles.iconBtn}><Captions size={20} color={Colors.onSurface} /></Pressable>
          </View>
        </View>

        <Text style={styles.note}>Replays support captions and the low-data audio-only mode, like lessons.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  stage: { backgroundColor: Colors.primary, borderRadius: Radius.xl, paddingVertical: Spacing.xxl, alignItems: 'center', gap: 8 },
  stageHint: { ...Typography.caption, color: Colors.inversePrimary },
  controls: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, marginTop: 4 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
