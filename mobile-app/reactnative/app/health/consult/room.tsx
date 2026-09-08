import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Send, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useConsult, useSendConsultMessage } from '@/features/health/hooks';
import { EMERGENCY_DISCLAIMER, relativeTime } from '@/features/health/constants/health.constants';

/**
 * Tele-consult A/V room placeholder with in-call chat + emergency disclaimer
 * (HL-11). The video surface is a placeholder — the WebRTC layer wires in later.
 */
export default function ConsultRoomScreen() {
  const { consultId } = useLocalSearchParams<{ consultId: string }>();
  const { data: consult, isLoading, isError, refetch } = useConsult(consultId);
  const sendMessage = useSendConsultMessage(consultId);

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [draft, setDraft] = useState('');

  const onSend = () => {
    const body = draft.trim();
    if (!body) return;
    sendMessage.mutate(body);
    setDraft('');
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeDark} edges={['top']}>
        <StateView kind="loading" message="Connecting…" />
      </SafeAreaView>
    );
  }
  if (isError || !consult) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="error" title="Consult unavailable" message="We couldn't connect." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeDark} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Video surface placeholder */}
        <View style={styles.stage}>
          <View style={styles.remoteTile}>
            {videoOff ? (
              <View style={styles.avatarBig}>
                <Text style={styles.avatarBigText}>
                  {consult.providerName.replace(/^Dr\.?\s*/, '').charAt(0)}
                </Text>
              </View>
            ) : (
              <Text style={styles.stageHint}>Provider video</Text>
            )}
            <Text style={styles.remoteName}>{consult.providerName}</Text>
          </View>
          <View style={styles.selfTile}>
            <Text style={styles.selfHint}>{videoOff ? 'Camera off' : 'You'}</Text>
          </View>

          {/* Emergency disclaimer overlay (HL-11) */}
          <View style={styles.disclaimer}>
            <TriangleAlert size={13} color={Colors.gold} strokeWidth={2.2} />
            <Text style={styles.disclaimerText} numberOfLines={2}>
              {EMERGENCY_DISCLAIMER}
            </Text>
          </View>
        </View>

        {/* In-call chat */}
        <View style={styles.chat}>
          <FlatList
            data={consult.messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.fromProvider ? styles.bubbleIn : styles.bubbleOut]}>
                <Text style={[styles.bubbleText, !item.fromProvider && styles.bubbleTextOut]}>{item.body}</Text>
                <Text style={[styles.bubbleTime, !item.fromProvider && styles.bubbleTimeOut]}>
                  {relativeTime(item.sentAt)}
                </Text>
              </View>
            )}
            contentContainerStyle={styles.chatList}
            ListEmptyComponent={<Text style={styles.chatEmpty}>Messages with your provider appear here.</Text>}
          />
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Message…"
              placeholderTextColor={Colors.outline}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={onSend}
              returnKeyType="send"
            />
            <Pressable onPress={onSend} style={styles.sendBtn} accessibilityLabel="Send message">
              <Send size={18} color={Colors.onPrimary} strokeWidth={2} />
            </Pressable>
          </View>
        </View>

        {/* Call controls */}
        <View style={styles.controls}>
          <Pressable
            style={[styles.ctrl, muted && styles.ctrlActive]}
            onPress={() => setMuted((m) => !m)}
            accessibilityLabel={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={22} color={Colors.white} strokeWidth={2} /> : <Mic size={22} color={Colors.white} strokeWidth={2} />}
          </Pressable>
          <Pressable
            style={[styles.ctrl, videoOff && styles.ctrlActive]}
            onPress={() => setVideoOff((v) => !v)}
            accessibilityLabel={videoOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {videoOff ? <VideoOff size={22} color={Colors.white} strokeWidth={2} /> : <Video size={22} color={Colors.white} strokeWidth={2} />}
          </Pressable>
          <Pressable style={[styles.ctrl, styles.ctrlEnd]} onPress={() => goBack('/health')} accessibilityLabel="End consult">
            <PhoneOff size={22} color={Colors.white} strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  safeDark: { flex: 1, backgroundColor: Colors.backdropDark },
  flex: { flex: 1 },
  stage: { flex: 1, padding: Spacing.md, justifyContent: 'center' },
  remoteTile: {
    flex: 1,
    backgroundColor: Colors.inverseSurface,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  stageHint: { ...Typography.bodyMd, color: Colors.inverseOnSurface, opacity: 0.6 },
  remoteName: { ...Typography.labelMd, color: Colors.inverseOnSurface },
  avatarBig: {
    width: 88,
    height: 88,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBigText: { ...Typography.displayLg, fontSize: 36, letterSpacing: -0.72, color: Colors.onPrimary },
  selfTile: {
    position: 'absolute',
    right: Spacing.lg,
    top: Spacing.lg,
    width: 96,
    height: 128,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  selfHint: { ...Typography.labelSm, color: Colors.onPrimary },
  disclaimer: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11,28,48,0.85)',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 8,
  },
  disclaimerText: { ...Typography.caption, color: Colors.inverseOnSurface, flex: 1, lineHeight: 14 },
  chat: { maxHeight: 240, backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  chatList: { padding: Spacing.md, gap: Spacing.sm, flexGrow: 1 },
  chatEmpty: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.md },
  bubble: { maxWidth: '82%', borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  bubbleIn: { alignSelf: 'flex-start', backgroundColor: Colors.surfaceContainerHigh },
  bubbleOut: { alignSelf: 'flex-end', backgroundColor: Colors.primary },
  bubbleText: { ...Typography.bodyMd, color: Colors.onSurface },
  bubbleTextOut: { color: Colors.onPrimary },
  bubbleTime: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  bubbleTimeOut: { color: 'rgba(255,255,255,0.7)' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  input: {
    flex: 1,
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surfaceContainerLowest },
  ctrl: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: Colors.inverseSurface, alignItems: 'center', justifyContent: 'center' },
  ctrlActive: { backgroundColor: Colors.outline },
  ctrlEnd: { backgroundColor: Colors.error },
});
