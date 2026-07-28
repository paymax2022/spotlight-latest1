import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MessageCircle, NotebookPen, AlertTriangle, RefreshCw, VideoOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { StatusBadge, CallStageView, CallControlBar, StateView } from '@/features/doctor/components';
import { useVetCallSession } from '@/features/doctor/hooks';
import { CALL_PROVIDER_LABELS, NETWORK_QUALITY_LABELS } from '@/features/doctor/constants';
import type { CallControls, NetworkQuality } from '@/types/doctor.batch2';

// Vet audio (S.13) + video (S.14) call — mirrors the human consult call, REUSING
// CallStageView / CallControlBar and the Batch 2 CallSessionRich via the
// VetCallSession wrapper. Audio vs video is session.base.mode; every
// reconnect/dropped/poor-network state is already modelled on CallSessionRich.
const toBadgeTone = (q: NetworkQuality) => {
  const t = NETWORK_QUALITY_LABELS[q].tone;
  return (t === 'success' ? 'success' : t === 'warning' ? 'warning' : t === 'danger' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';
};

export default function VetCallScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const petId = String(id);

  const { data: wrapper, isLoading, isError, refetch } = useVetCallSession(petId);
  const session = wrapper?.session;
  const petName = wrapper?.petName ?? 'Pet';
  const ownerName = wrapper?.ownerName ?? 'Owner';

  const [controls, setControls] = useState<CallControls>({ muted: false, cameraOn: true, speakerOn: true, frontCamera: true, minimized: false });
  const [seconds, setSeconds] = useState(0);

  const isVideo = (mode ?? session?.base.mode) !== 'audio';
  const phase = session?.phase ?? 'connecting';
  const isLive = phase === 'live';

  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isLive]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  if (isLoading && !session) {
    return (
      <SafeAreaView style={styles.safeLight} edges={['top']}>
        <StateView variant="loading" label="Preparing call" />
      </SafeAreaView>
    );
  }
  if (isError || !session) {
    return (
      <SafeAreaView style={styles.safeLight} edges={['top']}>
        <StateView variant="error" message="We could not start this call." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const subline = `${CALL_PROVIDER_LABELS[session.provider]} · ${NETWORK_QUALITY_LABELS[session.networkQuality].label} network · ${ownerName}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <LinearGradient colors={[Colors.primary, Colors.primaryContainer]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{phase.replace('_', ' ').toUpperCase()}</Text>
          </View>
          <StatusBadge label={NETWORK_QUALITY_LABELS[session.networkQuality].label} tone={toBadgeTone(session.networkQuality)} />
        </View>
        <Text style={styles.timer}>{mm}:{ss}</Text>
      </View>

      {/* Network / reconnect / disconnect states (REUSE CallSessionRich fields) */}
      {session.networkQuality === 'poor' && <Banner Icon={AlertTriangle} text="Poor network detected — audio/video may be affected." />}
      {phase === 'reconnecting' && <Banner Icon={RefreshCw} text="Reconnecting…" />}
      {session.providerFailed && <Banner Icon={AlertTriangle} text="Connection failed — switching provider." />}
      {!session.patientState.connected && <Banner Icon={AlertTriangle} text={`${ownerName} disconnected.`} />}

      <CallStageView
        phase={phase}
        patientName={petName}
        initials={session.base.patient.initials}
        avatarColor={session.base.patient.avatarColor}
        modeLabel={isVideo ? 'Video consultation' : 'Audio consultation'}
        subline={subline}
      />

      {isVideo && !controls.minimized && (
        <View style={styles.selfPreview}>
          {controls.cameraOn ? <Text style={styles.selfText}>You</Text> : <VideoOff size={20} color={Colors.white} strokeWidth={2} />}
        </View>
      )}

      {(phase === 'waiting_room' || phase === 'ringing' || phase === 'connecting') ? (
        <View style={styles.joinRow}>
          <PrimaryButton label={isVideo ? 'Join video call' : 'Join audio call'} onPress={() => refetch()} />
        </View>
      ) : (phase === 'dropped' || phase === 'ended' || phase === 'failed') ? (
        <View style={styles.joinRow}>
          <PrimaryButton label="Back to pet" onPress={() => router.replace(`/(doctor)/vet/pet/${petId}`)} />
        </View>
      ) : (
        <CallControlBar
          controls={controls}
          isVideo={isVideo}
          onToggleMute={() => setControls((c) => ({ ...c, muted: !c.muted }))}
          onToggleCamera={() => setControls((c) => ({ ...c, cameraOn: !c.cameraOn }))}
          onSwitchCamera={() => setControls((c) => ({ ...c, frontCamera: !c.frontCamera }))}
          onToggleSpeaker={() => setControls((c) => ({ ...c, speakerOn: !c.speakerOn }))}
          onToggleMinimize={() => setControls((c) => ({ ...c, minimized: !c.minimized }))}
          onEnd={() => router.replace(`/(doctor)/vet/pet/${petId}/soap`)}
        />
      )}

      {isLive && (
        <View style={styles.quickRow}>
          <Pressable onPress={() => router.push(`/(doctor)/vet/consult/${petId}/chat`)} style={styles.quickBtn} accessibilityRole="button" accessibilityLabel="Open chat">
            <MessageCircle size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
          <Pressable onPress={() => router.push(`/(doctor)/vet/pet/${petId}/soap`)} style={styles.quickBtn} accessibilityRole="button" accessibilityLabel="Open notes">
            <NotebookPen size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function Banner({ Icon, text }: { Icon: typeof AlertTriangle; text: string }) {
  return (
    <View style={styles.banner}>
      <Icon size={16} color={Colors.white} strokeWidth={2} />
      <Text style={styles.bannerText} numberOfLines={2}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.primary },
  safeLight:   { flex: 1, backgroundColor: Colors.background },
  topBar:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  topLeft:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  liveTag:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)' },
  liveDot:     { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: Colors.teal },
  liveText:    { ...Typography.labelSm, color: Colors.white, fontWeight: '700' },
  timer:       { ...Typography.labelLg, color: Colors.white },
  banner:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: 'rgba(0,0,0,0.25)' },
  bannerText:  { ...Typography.bodySm, color: Colors.white, flex: 1 },
  selfPreview: { position: 'absolute', top: 96, right: Spacing.containerMargin, width: 84, height: 116, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  selfText:    { ...Typography.labelMd, color: Colors.white },
  joinRow:     { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  quickRow:    { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md, paddingBottom: Spacing.md },
  quickBtn:    { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
