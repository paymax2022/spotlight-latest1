import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Mic, MicOff, PhoneOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useStartCall } from '@/features/connect/messaging/hooks';
import type { CallStatus } from '@/features/connect/messaging/types';

// MS-08 — Voice call. Starts the call on mount (kind:'voice'); status text is
// driven by the CallSession status. Simulated progression ringing -> active.

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting…',
  ringing: 'Ringing…',
  active: 'Connected',
  ended: 'Call ended',
  failed: 'Call failed',
};

export default function VoiceCall() {
  const params = useLocalSearchParams<{ threadId?: string; name?: string; avatar?: string }>();
  const threadId = String(params.threadId ?? '');
  const name = String(params.name ?? 'Caller');
  const avatar = params.avatar ? String(params.avatar) : '';

  const startCall = useStartCall();
  const [status, setStatus] = useState<CallStatus>('connecting');
  const [muted, setMuted] = useState(false);
  const started = useRef(false);

  const start = () => {
    startCall.mutate(
      { threadId, peerName: name, kind: 'voice', peerAvatar: avatar || undefined },
      { onSuccess: (session) => setStatus(session.status) },
    );
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
    // Simulated connect after ringing.
    const t = setTimeout(() => setStatus((s) => (s === 'ended' || s === 'failed' ? s : 'active')), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (startCall.error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView
          kind="error"
          icon="PhoneOff"
          title="Couldn’t start the call"
          message="Something went wrong connecting your call."
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
      <View style={styles.stage}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{name.charAt(0)}</Text>
          </View>
        )}
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.status}>{STATUS_LABEL[status]}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.ctrlBtn, muted && styles.ctrlBtnActive]}
          onPress={() => setMuted((m) => !m)}
          accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? (
            <MicOff size={26} color={Colors.onSurface} strokeWidth={2} />
          ) : (
            <Mic size={26} color={Colors.onSurface} strokeWidth={2} />
          )}
          <Text style={styles.ctrlLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
        </Pressable>

        <Pressable
          style={[styles.ctrlBtn, styles.endBtn]}
          onPress={() => goBack('/connect')}
          accessibilityLabel="End call"
        >
          <PhoneOff size={26} color={Colors.onPrimary} strokeWidth={2} />
          <Text style={[styles.ctrlLabel, styles.endLabel]}>End</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  avatar: { width: 132, height: 132, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.displayLg, color: Colors.onSurfaceVariant },
  name: { ...Typography.headlineMd, color: Colors.white, marginTop: Spacing.md },
  status: { ...Typography.bodyLg, color: Colors.inverseOnSurface },
  controls: {
    flexDirection: 'row', justifyContent: 'center', gap: Spacing.xl,
    paddingBottom: Spacing.xxl, paddingTop: Spacing.lg,
  },
  ctrlBtn: { alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  ctrlBtnActive: { opacity: 0.85 },
  ctrlLabel: { ...Typography.labelSm, color: Colors.white },
  endBtn: {
    width: 68, height: 68, borderRadius: Radius.full, backgroundColor: Colors.error,
    gap: 0,
  },
  endLabel: { color: Colors.onPrimary, position: 'absolute', bottom: -22 },
});
