import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useConsult, useSendConsultMessage, useCompleteConsult } from '@/features/health/vet/hooks';
import { relativeTime } from '@/features/health/constants/health.constants';

export default function TeleconsultScreen() {
  const { id, appointmentId } = useLocalSearchParams<{ id: string; appointmentId?: string }>();
  const { data: consult, isLoading, isError, refetch } = useConsult(id);
  const sendMsg = useSendConsultMessage(id);
  const complete = useCompleteConsult();

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [draft, setDraft] = useState('');

  const onSend = () => {
    if (!draft.trim()) return;
    sendMsg.mutate(draft.trim());
    setDraft('');
  };

  const onEnd = () => {
    complete.mutate(id, {
      onSuccess: (res) =>
        router.replace({ pathname: '/health/vet/consult-summary', params: { id: res.summaryId, appointmentId: appointmentId ?? '' } }),
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="loading" message="Connecting…" />
      </SafeAreaView>
    );
  }
  if (isError || !consult) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="error" title="Connection failed" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Video stage */}
      <View style={styles.stage}>
        <View style={styles.remote}>
          <View style={styles.remoteAvatar}>
            <Text style={styles.remoteAvatarText}>{consult.vetName.replace(/^Dr\.?\s*/, '').charAt(0)}</Text>
          </View>
          <Text style={styles.remoteName}>{consult.vetName}</Text>
          <Text style={styles.remoteSub}>Consult for {consult.petName}</Text>
        </View>
        <View style={styles.self}>
          {camOn ? <Video size={18} color={Colors.white} strokeWidth={2} /> : <VideoOff size={18} color={Colors.white} strokeWidth={2} />}
          <Text style={styles.selfText}>You</Text>
        </View>
      </View>

      {/* Chat */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.chatWrap}>
        <ScrollView contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false}>
          {consult.messages.map((m) => (
            <View key={m.id} style={[styles.bubbleRow, m.fromProvider ? styles.bubbleLeft : styles.bubbleRight]}>
              <View style={[styles.bubble, m.fromProvider ? styles.bubbleProvider : styles.bubbleMine]}>
                <Text style={[styles.bubbleText, !m.fromProvider && styles.bubbleTextMine]}>{m.body}</Text>
                <Text style={[styles.bubbleTime, !m.fromProvider && styles.bubbleTimeMine]}>{relativeTime(m.sentAt)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message your vet…"
            placeholderTextColor={Colors.outline}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={onSend}
          />
          <Pressable style={styles.sendBtn} onPress={onSend} accessibilityLabel="Send message">
            <Send size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable style={[styles.ctrl, !micOn && styles.ctrlOff]} onPress={() => setMicOn((v) => !v)} accessibilityLabel="Toggle mic">
          {micOn ? <Mic size={22} color={Colors.onSurface} strokeWidth={2} /> : <MicOff size={22} color={Colors.white} strokeWidth={2} />}
        </Pressable>
        <Pressable style={[styles.ctrl, !camOn && styles.ctrlOff]} onPress={() => setCamOn((v) => !v)} accessibilityLabel="Toggle camera">
          {camOn ? <Video size={22} color={Colors.onSurface} strokeWidth={2} /> : <VideoOff size={22} color={Colors.white} strokeWidth={2} />}
        </Pressable>
        <Pressable style={styles.end} onPress={onEnd} accessibilityLabel="End consult">
          <PhoneOff size={24} color={Colors.white} strokeWidth={2} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark },
  stage: { height: 260, margin: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.inverseSurface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  remote: { alignItems: 'center', gap: 6 },
  remoteAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  remoteAvatarText: { ...Typography.displayLg, fontSize: 36, color: Colors.inversePrimary },
  remoteName: { ...Typography.titleMd, color: Colors.white },
  remoteSub: { ...Typography.bodySm, color: Colors.inverseOnSurface },
  self: { position: 'absolute', right: Spacing.sm, bottom: Spacing.sm, width: 70, height: 90, borderRadius: Radius.md, backgroundColor: Colors.inversePrimary, alignItems: 'center', justifyContent: 'center', gap: 4 },
  selfText: { ...Typography.caption, color: Colors.white },
  chatWrap: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, overflow: 'hidden' },
  chat: { padding: Spacing.md, gap: Spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubbleLeft: { justifyContent: 'flex-start' },
  bubbleRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: Radius.lg, padding: Spacing.sm + 2, gap: 2 },
  bubbleProvider: { backgroundColor: Colors.surfaceContainerHigh, borderTopLeftRadius: 4 },
  bubbleMine: { backgroundColor: Colors.primary, borderTopRightRadius: 4 },
  bubbleText: { ...Typography.bodySm, color: Colors.onSurface },
  bubbleTextMine: { color: Colors.onPrimary },
  bubbleTime: { ...Typography.caption, color: Colors.onSurfaceVariant },
  bubbleTimeMine: { color: Colors.inversePrimary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  input: { flex: 1, height: 44, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surfaceContainerLowest },
  ctrl: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  ctrlOff: { backgroundColor: Colors.outline },
  end: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
});
