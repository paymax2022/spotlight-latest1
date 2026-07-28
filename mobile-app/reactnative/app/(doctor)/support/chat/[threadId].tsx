import React from 'react';
import { StyleSheet, Platform, KeyboardAvoidingView, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, ChatComposer, SupportMessageBubble } from '@/features/doctor/components';
import { useSupportMessages, useSendSupportMessage } from '@/features/doctor/hooks';

// ── Section AA — Support chat thread (AA.16) ───────────────────────────────────
// NEW screen: the support conversation for a ticket or dispute (threadId is the
// ticket / dispute id). Reuses ChatComposer for input and SupportMessageBubble
// for the doctor / agent / system author tones.

export default function SupportChatScreen() {
  const params = useLocalSearchParams<{ threadId: string; title?: string }>();
  const threadId = String(params.threadId);
  const { data: messages = [], isLoading, isError, refetch } = useSupportMessages(threadId);
  const send = useSendSupportMessage();

  const handleSend = async (body: string) => {
    try {
      await send.mutateAsync({ threadId, body });
    } catch {
      Alert.alert('Failed', 'Could not send the message. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title={params.title ?? 'Support Chat'} />
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
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<StateView variant="empty" icon={MessageSquare} title="No messages yet" message="Send a message to start the conversation." />}
            renderItem={({ item }) => <SupportMessageBubble message={item} />}
          />
        )}
        <ChatComposer onSend={handleSend} sending={send.isPending} placeholder="Message support" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm, flexGrow: 1 },
});
