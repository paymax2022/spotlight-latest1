import React, { useRef, useState } from 'react';
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
import { useTripMessages, useSendTripMessage } from '../hooks/useMobility';
import type { TripMessage, TripChatRole } from '../types/mobility.types';

interface Props {
  tripId: string;
  /** Whose composer this is — drives bubble alignment + outgoing sender_role. */
  myRole: TripChatRole;
}

const ROLE_LABEL: Record<TripChatRole, string> = { rider: 'Rider', driver: 'Driver' };

function relativeTime(iso: string): string {
  const then = +new Date(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

/**
 * Pre-arrival/en-route chat between the rider and the assigned driver — "I'm
 * outside", "which gate", "is this the right address". Distinct from the trip
 * PIN, which stays the at-the-door identity check. Polled (4s); the backend
 * also fans messages out over the trip WebSocket for a future realtime pass.
 */
export default function TripChatThread({ tripId, myRole }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<TripMessage>>(null);

  const messagesQuery = useTripMessages(tripId, myRole);
  const send = useSendTripMessage(tripId, myRole);
  const messages = messagesQuery.data ?? [];

  const onSend = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    send.mutate(body, {
      onSettled: () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80),
    });
  };

  const renderItem = ({ item }: { item: TripMessage }) => {
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
      style={s.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {messagesQuery.isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={s.center}>
          <Text style={s.empty}>No messages yet. Say hello to coordinate the pickup.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
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
