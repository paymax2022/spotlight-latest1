import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Hand, Send, Radio, Users, Flag, Mic, MicOff, Video, VideoOff, LogOut, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useLiveSession, useJoinLiveSession, useReportContent } from '@/features/academy/hooks';
import { joinLiveSession } from '@/features/academy/api';
import { parseConnection, describeConnectionFailure } from '@/features/academy/live/connection';
import { liveMessageEntityId } from '@/features/academy/live/report';
import { useLiveRoom } from '@/features/academy/live/useLiveRoom';
import { LiveStage } from '@/features/academy/live/LiveStage';

/**
 * Live class room (LiveKit). The same screen serves the host and the learners: what you can do is
 * decided by the permissions inside your LiveKit token, not by this screen. A host (canPublish)
 * gets mic/camera controls and sees raised hands; a learner watches, chats and raises a hand.
 * Chat is group-only (no DMs). Messages are not stored or filtered by the server, so anything
 * unsafe is reported (the report names the session, the sender and the message).
 */
export default function LiveRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useLiveSession(id);
  const join = useJoinLiveSession();
  const report = useReportContent();
  const [draft, setDraft] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => { if (id) join.mutate(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // Only a response that says "LiveKit" with a real token and a secure URL may be dialled.
  const parsed = React.useMemo(() => (join.data ? parseConnection(join.data, { allowInsecure: __DEV__ }) : null), [join.data]);
  const connection = parsed && parsed.ok ? parsed.connection : null;

  const fetchConnection = React.useCallback(async () => {
    if (!id) return null;
    const again = parseConnection(await joinLiveSession(id), { allowInsecure: __DEV__ });
    return again.ok ? again.connection : null;
  }, [id]);

  const room = useLiveRoom({ connection, fetchConnection });

  if (session.isLoading || join.isPending || join.isIdle) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader /><StateView kind="loading" message="Joining room…" /></SafeAreaView>;
  }
  if (session.isError || !session.data || join.isError) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader /><StateView kind="error" title="Unavailable" message="This session could not be joined." /></SafeAreaView>;
  }
  const s = session.data;

  if (room.status === 'unsupported') {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title={s.title} /><StateView kind="error" title="Open the app" message="Live classes run in the Paymax app on your phone." /></SafeAreaView>;
  }
  if (parsed && !parsed.ok) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title={s.title} /><StateView kind="error" title="Not available" message={describeConnectionFailure(parsed.reason)} /></SafeAreaView>;
  }

  if (room.status === 'ended' || room.status === 'failed') {
    const retry = room.status === 'failed' && room.end?.canRetry !== false;
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={s.title} />
        <View style={styles.endWrap}>
          <Text style={styles.endText}>{room.end?.message ?? room.error ?? 'You are no longer connected to this class.'}</Text>
          {retry ? <PrimaryButton label="Try again" onPress={() => void room.rejoin()} /> : null}
          <PrimaryButton label="Back to classes" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const send = () => {
    const r = room.sendChat(draft);
    if (r === 'sent') { setDraft(''); setNotice(null); }
    else if (r === 'rate_limited') setNotice('You are sending messages too fast. Wait a moment.');
    else if (r === 'invalid') setNotice('Write a message (up to 500 characters).');
    else setNotice('Not connected yet.');
  };

  const live = room.status === 'connected';
  const raised = Object.entries(room.hands);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={s.title} subtitle={s.host} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <View style={styles.stageWrap}>
          <LiveStage stage={room.stage} />
          <View style={styles.stageMeta}>
            <View style={styles.pill}><Radio size={12} color={live ? Colors.error : Colors.onSurfaceVariant} /><Text style={styles.pillText}>{live ? 'LIVE' : room.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</Text></View>
            <View style={styles.pill}><Users size={12} color={Colors.onSurfaceVariant} /><Text style={styles.pillText}>{room.participantCount}</Text></View>
            <View style={styles.pill}><ShieldCheck size={12} color={Colors.onSurfaceVariant} /><Text style={styles.pillText}>Group chat only</Text></View>
          </View>
        </View>

        {room.error ? <Text style={styles.error}>{room.error}</Text> : null}

        <View style={styles.controls}>
          {room.canPublish ? (
            <View style={styles.hostRow}>
              <Pressable style={[styles.ctl, room.micOn && styles.ctlOn]} onPress={() => void room.setMic(!room.micOn)} accessibilityLabel={room.micOn ? 'Mute microphone' : 'Unmute microphone'}>
                {room.micOn ? <Mic size={18} color={Colors.onPrimary} /> : <MicOff size={18} color={Colors.primary} />}
              </Pressable>
              <Pressable style={[styles.ctl, room.camOn && styles.ctlOn]} onPress={() => void room.setCam(!room.camOn)} accessibilityLabel={room.camOn ? 'Turn camera off' : 'Turn camera on'}>
                {room.camOn ? <Video size={18} color={Colors.onPrimary} /> : <VideoOff size={18} color={Colors.primary} />}
              </Pressable>
              <Text style={styles.watchOnly}>{raised.length ? `Hands: ${raised.map(([, h]) => h.name).join(', ')}` : 'No raised hands'}</Text>
            </View>
          ) : (
            <>
              <Pressable style={[styles.handBtn, room.handUp && styles.handBtnActive]} onPress={() => void room.toggleHand()}>
                <Hand size={18} color={room.handUp ? Colors.onPrimary : Colors.primary} />
                <Text style={[styles.handText, room.handUp && { color: Colors.onPrimary }]}>{room.handUp ? 'Hand raised' : 'Raise hand'}</Text>
              </Pressable>
              <Text style={styles.watchOnly}>Watch, chat and raise your hand · the host speaks</Text>
            </>
          )}
          <Pressable hitSlop={8} onPress={() => { void room.leave(); router.back(); }} accessibilityLabel="Leave class"><LogOut size={20} color={Colors.onSurfaceVariant} /></Pressable>
        </View>

        <ScrollView style={styles.chat} contentContainerStyle={styles.chatContent}>
          {room.messages.length === 0 ? <Text style={styles.watchOnly}>No messages yet. Keep questions on topic and be respectful.</Text> : null}
          {room.messages.map((m) => (
            <View key={`${m.from}:${m.id}`} style={styles.msgRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.msgFrom}>{m.self ? 'You' : m.name}</Text>
                <Text style={styles.msgBody}>{m.body}</Text>
              </View>
              {!m.self ? (
                <Pressable
                  hitSlop={8}
                  accessibilityLabel="Report this message"
                  onPress={() => report.mutate({ targetKind: 'message', targetId: liveMessageEntityId(s.id, m.from, m.id), reason: 'unsafe' })}
                >
                  <Flag size={14} color={report.isSuccess ? Colors.teal : Colors.onSurfaceVariant} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>

        {notice ? <Text style={styles.error}>{notice}</Text> : null}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message the class…"
            placeholderTextColor={Colors.onSurfaceVariant}
            value={draft}
            maxLength={500}
            onChangeText={(t) => { setDraft(t); if (notice) setNotice(null); }}
            onSubmitEditing={send}
            editable={live}
          />
          <Pressable style={[styles.sendBtn, !live && { opacity: 0.4 }]} onPress={send} disabled={!live} accessibilityLabel="Send message"><Send size={18} color={Colors.onPrimary} /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  stageWrap: { margin: Spacing.containerMargin, gap: Spacing.sm },
  stageMeta: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerHigh, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  pillText: { ...Typography.caption, color: Colors.onSurface, fontWeight: '700' },
  error: { ...Typography.caption, color: Colors.error, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.xs },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  ctl: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  ctlOn: { backgroundColor: Colors.primary },
  handBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple },
  handBtnActive: { backgroundColor: Colors.primary },
  handText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
  watchOnly: { ...Typography.caption, color: Colors.onSurfaceVariant, flexShrink: 1 },
  chat: { flex: 1, marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg },
  chatContent: { padding: Spacing.md, gap: Spacing.sm },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  msgFrom: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700' },
  msgBody: { ...Typography.bodyMd, color: Colors.onSurface },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.containerMargin },
  input: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, height: 44, color: Colors.onSurface, ...Typography.bodyMd },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  endWrap: { flex: 1, padding: Spacing.containerMargin, gap: Spacing.md, justifyContent: 'center' },
  endText: { ...Typography.bodyMd, color: Colors.onSurface, textAlign: 'center' },
});
