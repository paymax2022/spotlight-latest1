import React from 'react';
import { View, Text, FlatList, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Paperclip, MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, ChatComposer } from '@/features/doctor/components';
import { usePharmacyMessages, useSendPharmacyMessage } from '@/features/doctor/hooks';
import type { PharmacyMessage } from '@/types/doctor.batch3';

// ── Section L — Pharmacy clarification chat (L12 / L21) ────────────────────────
// NEW screen: a lightweight doctor ↔ pharmacist clarification thread. Reuses
// ChatComposer for input; the bubble is inline because PharmacyMessage uses a
// different author union than the Phase 1 ChatMessage MessageBubble expects.

export default function PharmacyChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const fulfilmentId = String(id);
  const { data: messages = [], isLoading, isError, refetch } = usePharmacyMessages(fulfilmentId);
  const send = useSendPharmacyMessage();

  const handleSend = async (body: string) => {
    try {
      await send.mutateAsync({ fulfilmentId, body });
    } catch {
      Alert.alert('Failed', 'Could not send the message. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pharmacy Chat" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {isLoading && messages.length === 0 ? (
          <StateView variant="loading" label="Loading conversation" />
        ) : isError ? (
          <StateView variant="error" message="We could not load this conversation." onRetry={() => refetch()} />
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<StateView variant="empty" icon={MessageSquare} title="No messages yet" message="Start a clarification with the pharmacist." />}
            renderItem={({ item }) => <Bubble message={item} />}
          />
        )}
        <ChatComposer onSend={handleSend} sending={send.isPending} placeholder="Message the pharmacist" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ message }: { message: PharmacyMessage }) {
  const mine = message.author === 'doctor';
  const time = new Date(message.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine && <Text style={styles.author}>Pharmacist</Text>}
        {!!message.attachmentName && (
          <View style={styles.attachment}>
            <Paperclip size={14} color={mine ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
            <Text style={[styles.attachmentName, mine && styles.textMine]} numberOfLines={1}>{message.attachmentName}</Text>
          </View>
        )}
        {!!message.body && <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>}
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  flex:           { flex: 1 },
  list:           { padding: Spacing.containerMargin, gap: Spacing.sm, flexGrow: 1 },
  row:            { width: '100%', flexDirection: 'row' },
  rowMine:        { justifyContent: 'flex-end' },
  rowTheirs:      { justifyContent: 'flex-start' },
  bubble:         { maxWidth: '80%', padding: Spacing.sm, borderRadius: Radius.lg, gap: 2 },
  bubbleMine:     { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs:   { backgroundColor: Colors.surfaceContainerLow, borderBottomLeftRadius: Radius.sm },
  author:         { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  attachment:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  attachmentName: { ...Typography.labelSm, color: Colors.primary, flexShrink: 1 },
  body:           { ...Typography.bodyMd, color: Colors.onSurface },
  textMine:       { color: Colors.onPrimary },
  time:           { ...Typography.caption },
  timeMine:       { color: Colors.onPrimary, opacity: 0.7, textAlign: 'right' },
  timeTheirs:     { color: Colors.onSurfaceVariant },
});
