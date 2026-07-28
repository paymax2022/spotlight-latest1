import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Send, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import ChatBubble from '@/features/investai/components/ChatBubble';
import SuggestedChip from '@/features/investai/components/SuggestedChip';
import { useAskAssistant } from '@/features/investai/hooks/useInvestAi';
import { SUGGESTED_QUESTIONS } from '@/features/investai/constants/ai.constants';
import type { ChatMessage, SuggestedQuestion } from '@/features/investai/types/ai.types';

let localSeq = 0;
const newUserId = () => `msg_u_${Date.now()}_${localSeq++}`;

/** Animated three-dot "assistant is typing" indicator. */
function TypingIndicator() {
  return (
    <View style={styles.typingRow}>
      <View style={styles.avatar}>
        <Sparkles size={16} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.typingBubble}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={styles.typingText}>Thinking…</Text>
      </View>
    </View>
  );
}

export default function InvestAiChatScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const ask = useAskAssistant();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const seeded = useRef(false);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || ask.isPending) return;
      const userMsg: ChatMessage = {
        id: newUserId(), role: 'user', text, at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      scrollToEnd();
      ask.mutate(
        { prompt: text },
        {
          onSuccess: (assistantMsg) => {
            setMessages((prev) => [...prev, assistantMsg]);
            scrollToEnd();
          },
        },
      );
    },
    [ask, scrollToEnd],
  );

  // Seed the chat with a starter question passed from the intro screen (once).
  useEffect(() => {
    if (!seeded.current && params.q) {
      seeded.current = true;
      send(params.q);
    }
  }, [params.q, send]);

  const onChip = (q: SuggestedQuestion) => send(q.text);
  const empty = messages.length === 0 && !ask.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invest AI" subtitle="Education assistant" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {empty ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <Sparkles size={28} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.emptyTitle}>Ask me about investing</Text>
            <Text style={styles.emptySub}>
              I explain how investing works — concepts, risks, and the app. I can't
              recommend assets or predict prices. Try one of these:
            </Text>
            <View style={styles.emptyChips}>
              {SUGGESTED_QUESTIONS.map((q) => (
                <SuggestedChip key={q.id} question={q} onPress={onChip} disabled={ask.isPending} />
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <ChatBubble message={item} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToEnd}
            ListFooterComponent={
              <>
                {ask.isPending ? <TypingIndicator /> : null}
                {ask.isError ? (
                  <StateView
                    kind="error"
                    title="Couldn't reach the assistant"
                    message={(ask.error as Error)?.message ?? 'Please try again.'}
                    actionLabel="Retry"
                    onAction={() => {
                      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                      if (lastUser) send(lastUser.text);
                    }}
                    compact
                  />
                ) : null}
              </>
            }
          />
        )}

        {/* Quick suggested chips above the composer (when a chat is in progress) */}
        {!empty ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickChips}
            keyboardShouldPersistTaps="handled"
          >
            {SUGGESTED_QUESTIONS.map((q) => (
              <SuggestedChip key={q.id} question={q} onPress={onChip} disabled={ask.isPending} />
            ))}
          </ScrollView>
        ) : null}

        {/* Composer */}
        <View style={styles.composer}>
          <View style={styles.inputWrap}>
            <TextInputField
              placeholder="Ask about investing…"
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send(input)}
              returnKeyType="send"
              multiline
              editable={!ask.isPending}
              style={styles.inputText}
            />
          </View>
          <Pressable
            onPress={() => send(input)}
            disabled={!input.trim() || ask.isPending}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [
              styles.sendBtn,
              (!input.trim() || ask.isPending) && styles.sendDisabled,
              pressed && styles.sendPressed,
            ]}
          >
            <Send size={20} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.md },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyIcon: {
    width: 64, height: 64, borderRadius: Radius.lg,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  emptySub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 20 },
  emptyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'center', marginTop: Spacing.md },

  typingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  avatar: {
    width: 32, height: 32, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
  },
  typingBubble: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderTopLeftRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  typingText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  quickChips: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.background,
  },
  inputWrap: { flex: 1 },
  inputText: { maxHeight: 120 },
  sendBtn: {
    width: 56, height: 56, borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendPressed: { opacity: 0.85 },
});
