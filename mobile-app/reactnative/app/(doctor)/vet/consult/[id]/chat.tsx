import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MessageSquare, ShieldCheck, Phone, Video as VideoIcon, NotebookPen } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { MessageBubble, ChatComposer, StateView } from '@/features/doctor/components';
import { useVetChatThread } from '@/features/doctor/hooks';
import { CHAT_PRESENCE_LABELS, SECURE_CHAT_NOTICE } from '@/features/doctor/constants';
import type { ChatMessageRich } from '@/types/doctor.batch5';

// Vet chat consultation (S.12) — mirrors the human consult chat, REUSING the
// Batch 2 ChatMessageRich / ChatThreadState shapes via the VetChatThread wrapper.
// Demo-safe: send is a local no-op (no batch5 send mutation in the contract);
// rich kinds render via MessageBubble for text + a directional bubble shell.
export default function VetChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);

  const { data: thread, isLoading, isError, refetch } = useVetChatThread(petId);

  const messages = thread?.messages ?? [];
  const petName = thread?.petName ?? 'Pet';
  const ownerName = thread?.ownerName ?? 'Owner';
  const presence = thread?.thread.patientPresence.status;
  const presenceLabel = presence ? CHAT_PRESENCE_LABELS[presence] : undefined;
  const ended = thread?.thread.lifecycle === 'ended';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TeleHeader
        title={presenceLabel ? `${petName} · ${presenceLabel}` : petName}
        right={
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push(`/(doctor)/vet/consult/${petId}/call?mode=audio`)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Start audio call">
              <Phone size={18} color={Colors.secondary} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => router.push(`/(doctor)/vet/consult/${petId}/call?mode=video`)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Start video call">
              <VideoIcon size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => router.push(`/(doctor)/vet/pet/${petId}/soap`)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Open SOAP notes">
              <NotebookPen size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {isLoading && messages.length === 0 ? (
          <StateView variant="loading" label="Loading messages" />
        ) : isError || !thread ? (
          <StateView variant="error" message="We could not load this conversation." onRetry={() => refetch()} />
        ) : (
          <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} contentContainerStyle={styles.messages}>
            <View style={styles.secureBanner}>
              <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.secureText}>{thread.thread.secureNotice || SECURE_CHAT_NOTICE}</Text>
            </View>

            <View style={styles.contextNote}>
              <Text style={styles.contextText}>Consultation with {ownerName} about {petName}.</Text>
            </View>

            {messages.length === 0 ? (
              <StateView variant="empty" icon={MessageSquare} title="No messages yet" message="Send the first message to start the consultation." />
            ) : (
              messages.map((m) => <VetMessage key={m.base.id} message={m} />)
            )}
          </ScrollView>
        )}

        {ended ? (
          <View style={styles.endedBar}>
            <Text style={styles.endedText}>This chat has ended.</Text>
          </View>
        ) : (
          <ChatComposer onSend={() => {}} sending={false} placeholder={`Message ${ownerName}`} />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function VetMessage({ message }: { message: ChatMessageRich }) {
  const mine = message.base.author === 'doctor';
  const time = new Date(message.base.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

  if (message.kind === 'system') {
    return <View style={styles.systemRow}><Text style={styles.systemText}>{message.base.body}</Text></View>;
  }

  if (message.kind === 'text') {
    return <MessageBubble message={message.base} />;
  }

  return (
    <View style={[styles.richRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.richBubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.richBody, mine && styles.textMine]}>{message.base.body || '[Attachment]'}</Text>
        <Text style={[styles.richTime, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  flex:          { flex: 1 },
  headerActions: { flexDirection: 'row', gap: Spacing.xs },
  iconBtn:       { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  messages:      { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, gap: Spacing.sm, flexGrow: 1 },
  secureBanner:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal },
  secureText:    { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  contextNote:   { padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple },
  contextText:   { ...Typography.caption, color: Colors.onSurface },
  systemRow:     { alignItems: 'center', paddingVertical: Spacing.xs },
  systemText:    { ...Typography.caption, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full, textAlign: 'center', overflow: 'hidden' },
  richRow:       { width: '100%', flexDirection: 'column' },
  rowMine:       { alignItems: 'flex-end' },
  rowTheirs:     { alignItems: 'flex-start' },
  richBubble:    { maxWidth: '82%', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: Radius.lg, gap: 6 },
  bubbleMine:    { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs:  { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderBottomLeftRadius: Radius.sm },
  richBody:      { ...Typography.bodyMd, color: Colors.onSurface },
  textMine:      { color: Colors.onPrimary },
  richTime:      { ...Typography.caption, alignSelf: 'flex-end' },
  timeMine:      { color: 'rgba(255,255,255,0.75)' },
  timeTheirs:    { color: Colors.onSurfaceVariant },
  endedBar:      { padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, alignItems: 'center', backgroundColor: Colors.background },
  endedText:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
