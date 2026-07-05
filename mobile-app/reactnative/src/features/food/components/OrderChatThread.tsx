import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useMessages, useSendMessage } from '../hooks';
import { useOrderRealtime } from '../useOrderRealtime';
import { relativeTime } from '../utils';
import type { ChatMessage, ChatSenderRole, OrderStatus } from '../types';

interface Props {
  orderId: string;
  /** Whose composer this is — drives bubble alignment + outgoing sender_role. */
  myRole: 'customer' | 'restaurant' | 'rider';
  /** Current order status, so realtime can decide whether to keep the socket open. */
  orderStatus?: OrderStatus;
  /** Optional fixed height for an embedded thread; omit to fill its parent. */
  height?: number;
}

const ROLE_LABEL: Record<ChatSenderRole, string> = {
  customer: 'Customer',
  restaurant: 'Restaurant',
  rider: 'Rider',
  system: 'Update',
};

/**
 * Shared chat surface used by all three roles. Fed by the messages REST endpoint
 * (polled as the offline/mock fallback) merged with messages pushed over
 * useOrderRealtime's WebSocket, deduped by id. Sending posts via the messages API
 * with the composer owner's role.
 */
export default function OrderChatThread({ orderId, myRole, orderStatus, height }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const realtime = useOrderRealtime(orderId, { status: orderStatus, chatOnly: true });
  // Poll the REST list when realtime isn't carrying the conversation.
  const messagesQuery = useMessages(orderId, { poll: !realtime.live });
  const send = useSendMessage(orderId);

  const merged = useMemo<ChatMessage[]>(() => {
    const byId = new Map<string, ChatMessage>();
    for (const m of messagesQuery.data ?? []) byId.set(m.id, m);
    for (const m of realtime.messages) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  }, [messagesQuery.data, realtime.messages]);

  const onSend = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    send.mutate(
      { body, senderRole: myRole },
      { onSettled: () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80) },
    );
  };

  const renderItem = ({ item }: { item: ChatMessage }) => {
    if (item.senderRole === 'system') {
      return (
        <View style={s.systemRow}>
          <Text style={s.systemText}>{item.body}</Text>
        </View>
      );
    }
    const mine = item.senderRole === myRole;
    return (
      <View style={[s.bubbleRow, mine ? s.bubbleRowMine : s.bubbleRowTheirs]}>
        <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
          {!mine && <Text style={s.senderLabel}>{ROLE_LABEL[item.senderRole]}</Text>}
          <Text style={[s.bubbleText, mine && s.bubbleTextMine]}>{item.body}</Text>
          <Text style={[s.time, mine && s.timeMine]}>{relativeTime(item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[s.wrap, height != null && { height }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {messagesQuery.isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : merged.length === 0 ? (
        <View style={s.center}>
          <Text style={s.empty}>No messages yet. Say hello to coordinate the delivery.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={merged}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message…"
          placeholderTextColor={Colors.outline}
          multiline
          returnKeyType="send"
          onSubmitEditing={onSend}
          blurOnSubmit
        />
        <Pressable
          onPress={onSend}
          disabled={!draft.trim() || send.isPending}
          style={[s.sendBtn, (!draft.trim() || send.isPending) && s.sendBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          {send.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Send size={18} color={Colors.white} strokeWidth={2} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  empty: { ...Typography.bodyMd, color: Colors.outline, textAlign: 'center' },
  listContent: { padding: Spacing.md, gap: Spacing.sm, flexGrow: 1, justifyContent: 'flex-end' },
  systemRow: { alignItems: 'center', marginVertical: Spacing.xs },
  systemText: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    backgroundColor: Colors.surfaceContainer,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    textAlign: 'center',
    overflow: 'hidden',
  },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  bubbleMine: { backgroundColor: Colors.secondary, borderBottomRightRadius: Radius.sm },
  bubbleTheirs: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    borderBottomLeftRadius: Radius.sm,
  },
  senderLabel: { ...Typography.labelSm, color: Colors.secondary, marginBottom: 2 },
  bubbleText: { ...Typography.bodyMd, color: Colors.onSurface },
  bubbleTextMine: { color: Colors.white },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.8)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  input: {
    ...Typography.bodyMd,
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.outlineVariant },
});
