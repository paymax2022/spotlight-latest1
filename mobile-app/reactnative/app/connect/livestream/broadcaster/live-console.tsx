import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Eye, Mic, MicOff, Users, Swords, ShieldAlert, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useBroadcastSession } from '@/features/connect/live/hooks';

/** Broadcaster live console (PRD §10.7 LB-03/06/07): viewer count, co-host, controls, earnings. */
export default function LiveConsoleScreen() {
  const q = useBroadcastSession();
  const [muted, setMuted] = useState(false);

  if (q.isLoading) return <SafeAreaView style={styles.safe}><StateView kind="loading" message="Starting console…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><StateView kind="error" title="Console error" actionLabel="Retry" onAction={() => q.refetch()} /></SafeAreaView>;
  const s = q.data;
  const mins = Math.floor(s.elapsedSec / 60);

  function endStream() {
    router.replace('/connect/livestream/broadcaster/ended-summary');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.stage}>
        <View style={styles.scrim} />
        {/* Top metrics */}
        <View style={styles.topBar}>
          <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE · {mins}m</Text></View>
          <View style={styles.metricsRow}>
            <View style={styles.metric}><Eye size={13} color={Colors.onPrimary} strokeWidth={2.2} /><Text style={styles.metricText}>{s.viewerCount.toLocaleString('en-NG')}</Text></View>
            <Pressable style={styles.earningsPill} onPress={() => router.push('/connect/livestream/broadcaster/earnings')} accessibilityLabel="View earnings">
              <Gift size={13} color={Colors.onPrimary} strokeWidth={2.2} />
              <Text style={styles.earningsText}>{formatKobo(s.earningsKobo)}</Text>
            </Pressable>
          </View>
        </View>

        {s.coHostName ? (
          <View style={styles.cohostBanner}><Users size={13} color={Colors.onPrimary} strokeWidth={2.2} /><Text style={styles.cohostText}>{s.coHostName} is co-hosting</Text></View>
        ) : null}

        {/* Bottom controls */}
        <View style={styles.controls}>
          <View style={styles.ctrlRow}>
            <Pressable style={styles.ctrl} onPress={() => setMuted((v) => !v)} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
              {muted ? <MicOff size={22} color={Colors.error} strokeWidth={2.2} /> : <Mic size={22} color={Colors.onPrimary} strokeWidth={2.2} />}
              <Text style={styles.ctrlLabel}>{muted ? 'Muted' : 'Mute'}</Text>
            </Pressable>
            <Pressable style={styles.ctrl} onPress={() => router.push('/connect/livestream/broadcaster/invite-cohost')} accessibilityLabel="Invite co-host">
              <Users size={22} color={Colors.onPrimary} strokeWidth={2.2} />
              <Text style={styles.ctrlLabel}>Co-host</Text>
            </Pressable>
            <Pressable style={styles.ctrl} onPress={() => router.push('/connect/livestream/broadcaster/pk-invite')} accessibilityLabel="Start PK battle">
              <Swords size={22} color={Colors.onPrimary} strokeWidth={2.2} />
              <Text style={styles.ctrlLabel}>PK</Text>
            </Pressable>
            <Pressable style={styles.ctrl} onPress={() => router.push('/connect/livestream/broadcaster/moderation')} accessibilityLabel="Moderation">
              <ShieldAlert size={22} color={Colors.onPrimary} strokeWidth={2.2} />
              <Text style={styles.ctrlLabel}>Mod</Text>
            </Pressable>
          </View>
          <Pressable style={styles.endBtn} onPress={endStream} accessibilityRole="button" accessibilityLabel="End stream">
            <Text style={styles.endText}>End stream</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark },
  stage: { flex: 1, justifyContent: 'space-between', backgroundColor: Colors.gradientCard[1] },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,28,48,0.25)' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.error, paddingHorizontal: 9, paddingVertical: 4, borderRadius: Radius.full },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.onPrimary },
  liveText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '800' as const },
  metricsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(11,28,48,0.5)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.full },
  metricText: { ...Typography.labelMd, color: Colors.onPrimary },
  earningsPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ConnectColors.ok, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  earningsText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  cohostBanner: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(11,28,48,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  cohostText: { ...Typography.labelSm, color: Colors.onPrimary },
  controls: { padding: Spacing.md, gap: Spacing.md },
  ctrlRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'rgba(11,28,48,0.45)', borderRadius: Radius.lg, paddingVertical: Spacing.md },
  ctrl: { alignItems: 'center', gap: 4 },
  ctrlLabel: { ...Typography.labelSm, color: Colors.onPrimary, fontSize: 11 },
  endBtn: { backgroundColor: Colors.error, borderRadius: Radius.lg, height: 52, alignItems: 'center', justifyContent: 'center' },
  endText: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '700' as const },
});
