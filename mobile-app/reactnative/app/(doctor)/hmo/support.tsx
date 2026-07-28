import React from 'react';
import { View, Text, FlatList, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, ChatComposer } from '@/features/doctor/components';
import { useHmoSupportThread, useSendHmoSupportMessage } from '@/features/doctor/hooks';
import type { HmoSupportMessage } from '@/types/doctor.batch4';

// Section O (O18) — NEW screen: HMO support chat thread. Reuses ChatComposer;
// bubble is inline because HmoSupportMessage uses the 'doctor' | 'patient' | 'hmo'
// author union (MessageBubble expects the Phase 1 ChatMessage author shape).
export default function HmoSupportScreen() {
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  const id = threadId ? String(threadId) : 'hmoth-1';
  const { data: thread, isLoading, isError, refetch } = useHmoSupportThread(id);
  const send = useSendHmoSupportMessage();

  const handleSend = async (body: string) => {
    try {
      await send.mutateAsync({ threadId: id, body });
    } catch {
      Alert.alert('Failed', 'Could not send the message. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title={thread?.provider ?? 'HMO Support'} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {isLoading && !thread ? (
          <StateView variant="loading" label="Loading conversation" />
        ) : isError || !thread ? (
          <StateView variant="error" message="We could not load this conversation." onRetry={() => refetch()} />
        ) : (
          <>
            {!!thread.subject && <Text style={styles.subject} numberOfLines={1}>{thread.subject}</Text>}
            <FlatList
              data={thread.messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<StateView variant="empty" icon={MessageSquare} title="No messages yet" message="Start a query with the HMO." />}
              renderItem={({ item }) => <Bubble message={item} />}
            />
          </>
        )}
        <ChatComposer onSend={handleSend} sending={send.isPending} placeholder="Message the HMO" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ message }: { message: HmoSupportMessage }) {
  const mine = message.author === 'doctor';
  const authorLabel = message.author === 'hmo' ? 'HMO' : message.author === 'patient' ? 'Patient' : 'You';
  const time = new Date(message.createdAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine && <Text style={styles.author}>{authorLabel}</Text>}
        <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  flex:         { flex: 1 },
  subject:      { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  list:         { padding: Spacing.containerMargin, gap: Spacing.sm, flexGrow: 1 },
  row:          { width: '100%', flexDirection: 'row' },
  rowMine:      { justifyContent: 'flex-end' },
  rowTheirs:    { justifyContent: 'flex-start' },
  bubble:       { maxWidth: '80%', padding: Spacing.sm, borderRadius: Radius.lg, gap: 2 },
  bubbleMine:   { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs: { backgroundColor: Colors.surfaceContainerLow, borderBottomLeftRadius: Radius.sm },
  author:       { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  body:         { ...Typography.bodyMd, color: Colors.onSurface },
  textMine:     { color: Colors.onPrimary },
  time:         { ...Typography.caption },
  timeMine:     { color: Colors.onPrimary, opacity: 0.7, textAlign: 'right' },
  timeTheirs:   { color: Colors.onSurfaceVariant },
});
