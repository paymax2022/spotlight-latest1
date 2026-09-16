import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useStartCall } from '@/features/connect/messaging/hooks';
import type { CallStatus } from '@/features/connect/messaging/types';

// MS-09 — Video call. Like voice (kind:'video') plus a camera toggle and a
// self-view placeholder. Status text driven by the CallSession status.

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting…',
  ringing: 'Ringing…',
  active: 'Connected',
  ended: 'Call ended',
  failed: 'Call failed',
};

export default function VideoCall() {
  const params = useLocalSearchParams<{ threadId?: string; name?: string; avatar?: string }>();
  const threadId = String(params.threadId ?? '');
  const name = String(params.name ?? 'Caller');
  const avatar = params.avatar ? String(params.avatar) : '';

  const startCall = useStartCall();
  const [status, setStatus] = useState<CallStatus>('connecting');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const started = useRef(false);

  const start = () => {
    startCall.mutate(
      { threadId, peerName: name, kind: 'video', peerAvatar: avatar || undefined },
      { onSuccess: (session) => setStatus(session.status) },
    );
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
    const t = setTimeout(() => setStatus((s) => (s === 'ended' || s === 'failed' ? s : 'active')), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (startCall.error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView
          kind="error"
          icon="VideoOff"
          title="Couldn’t start the call"
          message="Something went wrong connecting your video call."
          actionLabel="Retry"
          onAction={() => {
            startCall.reset();
            setStatus('connecting');
            start();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Remote video stage (peer avatar stands in for the remote feed). */}
      <View style={styles.stage}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.remoteFeed} blurRadius={status === 'active' ? 0 : 8} />
        ) : (
          <View style={[styles.remoteFeed, styles.remoteFallback]}>
            <Text style={styles.avatarInitial}>{name.charAt(0)}</Text>
          </View>
        )}

        <View style={styles.overlayTop}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.status}>{STATUS_LABEL[status]}</Text>
        </View>

        {/* Self-view placeholder. */}
        <View style={styles.selfView}>
          {cameraOff ? (
            <VideoOff size={22} color={Colors.inverseOnSurface} strokeWidth={2} />
          ) : (
            <Text style={styles.selfViewText}>You</Text>
          )}
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.ctrlBtn, muted && styles.ctrlBtnActive]}
          onPress={() => setMuted((m) => !m)}
          accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicOff size={24} color={Colors.white} strokeWidth={2} /> : <Mic size={24} color={Colors.white} strokeWidth={2} />}
          <Text style={styles.ctrlLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
        </Pressable>

        <Pressable
          style={[styles.ctrlBtn, cameraOff && styles.ctrlBtnActive]}
          onPress={() => setCameraOff((c) => !c)}
          accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'}
        >
          {cameraOff ? <VideoOff size={24} color={Colors.white} strokeWidth={2} /> : <Video size={24} color={Colors.white} strokeWidth={2} />}
          <Text style={styles.ctrlLabel}>{cameraOff ? 'Camera on' : 'Camera off'}</Text>
        </Pressable>

        <Pressable style={[styles.ctrlBtn, styles.endBtn]} onPress={() => goBack('/connect')} accessibilityLabel="End call">
          <PhoneOff size={24} color={Colors.onPrimary} strokeWidth={2} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark },
  stage: { flex: 1 },
  remoteFeed: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', backgroundColor: Colors.surfaceContainerHigh },
  remoteFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.displayLg, color: Colors.onSurfaceVariant },
  overlayTop: { alignItems: 'center', paddingTop: Spacing.xl, gap: 4 },
  name: { ...Typography.headlineMd, color: Colors.white },
  status: { ...Typography.bodyMd, color: Colors.inverseOnSurface },
  selfView: {
    position: 'absolute', top: Spacing.xl, right: Spacing.containerMargin,
    width: 92, height: 130, borderRadius: Radius.lg, backgroundColor: ConnectColors.brand,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.white,
  },
  selfViewText: { ...Typography.labelMd, color: Colors.white },
  controls: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.xl,
    paddingBottom: Spacing.xxl, paddingTop: Spacing.lg,
  },
  ctrlBtn: { alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, minWidth: 64 },
  ctrlBtnActive: { opacity: 0.85 },
  ctrlLabel: { ...Typography.labelSm, color: Colors.white },
  endBtn: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.error, gap: 0 },
});
