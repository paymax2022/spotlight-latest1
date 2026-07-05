import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Hand, Send, ShieldCheck, Radio, Users, Flag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useLiveSession, useJoinLiveSession, useReportContent } from '@/features/academy/hooks';

type ChatMsg = { id: string; from: string; body: string; mod?: boolean };

/**
 * C2 — Live class room. LiveKit placeholder (mock room view): join → token, with
 * moderated chat, raise-hand, and report. Child-safety: group chat only — no DMs.
 */
export default function LiveRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useLiveSession(id);
  const join = useJoinLiveSession();
  const report = useReportContent();
  const [handRaised, setHandRaised] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    { id: 'm1', from: 'Moderator', body: 'Welcome! Keep questions on topic. Be respectful.', mod: true },
    { id: 'm2', from: 'Ada', body: 'Can you repeat the sizing formula?' },
  ]);

  React.useEffect(() => { if (id) join.mutate(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (session.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Joining room…" /></SafeAreaView>;
  if (session.isError || !session.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Unavailable" message="This session could not be joined." /></SafeAreaView>;

  const s = session.data;
  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setMessages((m) => [...m, { id: `m_${Date.now()}`, from: 'You', body }]);
    setDraft('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={s.title} subtitle={s.host} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        {/* Video stage placeholder (LiveKit) */}
        <View style={styles.stage}>
          <Radio size={36} color={Colors.gold} />
          <Text style={styles.stageTitle}>LiveKit room · {join.data?.roomName ?? `academy-${id}`}</Text>
          <View style={styles.stageMeta}>
            <View style={styles.stagePill}><Radio size={12} color={Colors.error} /><Text style={styles.stagePillText}>LIVE</Text></View>
            <View style={styles.stagePill}><Users size={12} color={Colors.onPrimary} /><Text style={styles.stagePillText}>{s.viewers ?? 0}</Text></View>
            <View style={styles.stagePill}><ShieldCheck size={12} color={Colors.onPrimary} /><Text style={styles.stagePillText}>Moderated</Text></View>
          </View>
          <Text style={styles.stageHint}>Video placeholder — real LiveKit client mounts here.</Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <Pressable style={[styles.handBtn, handRaised && styles.handBtnActive]} onPress={() => setHandRaised((h) => !h)}>
            <Hand size={18} color={handRaised ? Colors.onPrimary : Colors.primary} />
            <Text style={[styles.handText, handRaised && { color: Colors.onPrimary }]}>{handRaised ? 'Hand raised' : 'Raise hand'}</Text>
          </Pressable>
          <Text style={styles.watchOnly}>Watch + raise hand · host speaks</Text>
        </View>

        {/* Moderated group chat */}
        <ScrollView style={styles.chat} contentContainerStyle={styles.chatContent}>
          {messages.map((m) => (
            <View key={m.id} style={styles.msgRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.msgFrom, m.mod && { color: Colors.primary }]}>{m.from}{m.mod ? ' · mod' : ''}</Text>
                <Text style={styles.msgBody}>{m.body}</Text>
              </View>
              {!m.mod && m.from !== 'You' ? (
                <Pressable hitSlop={8} onPress={() => report.mutate({ targetKind: 'message', targetId: m.id, reason: 'unsafe' })}>
                  <Flag size={14} color={report.isSuccess ? Colors.teal : Colors.onSurfaceVariant} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message the class (moderated)…"
            placeholderTextColor={Colors.onSurfaceVariant}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
          />
          <Pressable style={styles.sendBtn} onPress={send}><Send size={18} color={Colors.onPrimary} /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  stage: { margin: Spacing.containerMargin, backgroundColor: Colors.primary, borderRadius: Radius.xl, paddingVertical: Spacing.xl, alignItems: 'center', gap: 6 },
  stageTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  stageMeta: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  stagePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  stagePillText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' },
  stageHint: { ...Typography.caption, color: Colors.inversePrimary, marginTop: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  handBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple },
  handBtnActive: { backgroundColor: Colors.primary },
  handText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
  watchOnly: { ...Typography.caption, color: Colors.onSurfaceVariant, flexShrink: 1, textAlign: 'right' },
  chat: { flex: 1, marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg },
  chatContent: { padding: Spacing.md, gap: Spacing.sm },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  msgFrom: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700' },
  msgBody: { ...Typography.bodyMd, color: Colors.onSurface },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.containerMargin },
  input: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, height: 44, color: Colors.onSurface, ...Typography.bodyMd },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
});
