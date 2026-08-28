import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Image, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import {
  ArrowLeft, BadgeCheck, Phone, Video, ShieldAlert,
  Send, Sparkles, MapPin, Lock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useThread, useSendMessage } from '@/features/connect/messaging/hooks';
import type { Message, ThreadDetail } from '@/features/connect/messaging/types';

// MS-02 — Thread / conversation. THE core safety screen.
// §4 GATE: a Date thread that is not a confirmed mutual match HARD-LOCKS the
// composer (disabled input + banner). The send hook also throws, but the UI
// prevents it pre-emptively. §3: "Share location" sends an APPROXIMATE label,
// never raw coordinates.

const APPROX_LOCATION = 'Around Victoria Island, Lagos';

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function MessageBubble({ message }: { message: Message }) {
  if (message.kind === 'system') {
    return (
      <View style={styles.systemWrap}>
        <Text style={styles.systemText}>{message.body}</Text>
      </View>
    );
  }

  const mine = message.fromMe;
  const isLocation = message.kind === 'location';
  const isIcebreaker = message.kind === 'icebreaker';

  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          isIcebreaker && styles.bubbleIcebreaker,
        ]}
      >
        {isIcebreaker ? (
          <View style={styles.icebreakerTag}>
            <Sparkles size={12} color={ConnectColors.brand} strokeWidth={2.4} />
            <Text style={styles.icebreakerTagText}>Icebreaker</Text>
          </View>
        ) : null}

        {isLocation ? (
          <View style={styles.locationRow}>
            <MapPin size={16} color={mine ? Colors.onPrimary : ConnectColors.brand} strokeWidth={2.2} />
            <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
              {message.locationLabel ?? message.body}
            </Text>
          </View>
        ) : (
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
        )}

        <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
          {relativeTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export default function MessageThread() {
  const params = useLocalSearchParams<{ threadId?: string; icebreaker?: string }>();
  const threadId = String(params.threadId ?? '');
  const thread = useThread(threadId);
  const send = useSendMessage(threadId);

  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<Message>>(null);
  const prefilled = useRef(false);

  // Read optional `icebreaker` param (handed off by icebreakers.tsx) and prefill
  // the composer once on mount.
  useEffect(() => {
    if (params.icebreaker && !prefilled.current) {
      prefilled.current = true;
      setDraft(String(params.icebreaker));
    }
  }, [params.icebreaker]);

  const data = thread.data;

  // §4 — composer hard-lock condition.
  const locked = !!data && data.mode === 'date' && data.gate !== 'matched';

  const threadRef = useMemo(
    () => (data ? { id: data.id, mode: data.mode, gate: data.gate } : null),
    [data],
  );

  const onSend = (kind: Message['kind'] = 'text', body?: string, locationLabel?: string) => {
    if (!threadRef || locked) return; // pre-emptive guard (§4)
    const text = body ?? draft.trim();
    if (kind === 'text' && !text) return;
    send.mutate(
      { thread: threadRef, body: text, kind, locationLabel },
      {
        onSuccess: () => {
          if (kind === 'text') setDraft('');
          requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/connect')} hitSlop={10} style={styles.headerBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>

        <View style={styles.headerCenter}>
          {data?.peerAvatar ? (
            <Image source={{ uri: data.peerAvatar }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback]} />
          )}
          <View style={styles.headerName}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>{data?.peerName ?? 'Chat'}</Text>
              {data?.peerVerified ? <BadgeCheck size={15} color={ConnectColors.ok} strokeWidth={2.4} /> : null}
            </View>
            {data ? (
              <View style={styles.headerStatusRow}>
                {data.peerOnline ? <View style={styles.onlineDot} /> : null}
                <Text style={styles.headerStatus}>{data.peerOnline ? 'Online' : 'Offline'}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {data ? (
          <View style={styles.headerActions}>
            <Pressable
              hitSlop={8}
              style={styles.headerBtn}
              onPress={() =>
                router.push(
                  `/connect/messaging/voice-call?threadId=${data.id}&name=${encodeURIComponent(data.peerName)}&avatar=${encodeURIComponent(data.peerAvatar ?? '')}`,
                )
              }
            >
              <Phone size={20} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable
              hitSlop={8}
              style={styles.headerBtn}
              onPress={() =>
                router.push(
                  `/connect/messaging/video-call?threadId=${data.id}&name=${encodeURIComponent(data.peerName)}&avatar=${encodeURIComponent(data.peerAvatar ?? '')}`,
                )
              }
            >
              <Video size={20} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable
              hitSlop={8}
              style={styles.headerBtn}
              accessibilityLabel="Safety options"
              onPress={() =>
                router.push(
                  `/connect/messaging/safety?threadId=${data.id}&peerId=${data.peerId}&name=${encodeURIComponent(data.peerName)}&mode=${data.mode}`,
                )
              }
            >
              <ShieldAlert size={20} color={ConnectColors.danger} strokeWidth={2} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {thread.isLoading ? (
        <StateView kind="loading" message="Loading conversation…" />
      ) : thread.error ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Could not load this chat"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => thread.refetch()}
        />
      ) : !data ? (
        <StateView kind="empty" icon="MessageCircle" title="Conversation not found" />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <FlatList
            ref={listRef}
            data={data.messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            contentContainerStyle={styles.messages}
            ListEmptyComponent={
              <View style={styles.emptyThread}>
                <Text style={styles.emptyThreadText}>No messages yet — say hello!</Text>
              </View>
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />

          {send.error ? (
            <View style={styles.sendError}>
              <Text style={styles.sendErrorText}>
                {(send.error as Error)?.message ?? 'Message could not be sent.'}
              </Text>
            </View>
          ) : null}

          {locked ? (
            // §4 — HARD LOCK. No composer; an explanatory banner instead.
            <View style={styles.lockBanner}>
              <Lock size={18} color={ConnectColors.muted} strokeWidth={2} />
              <Text style={styles.lockText}>
                You matched? You can chat once you both like each other.
              </Text>
            </View>
          ) : (
            <View style={styles.composer}>
              <Pressable
                style={styles.composerIconBtn}
                accessibilityLabel="Icebreakers"
                onPress={() => router.push(`/connect/messaging/icebreakers?threadId=${data.id}`)}
              >
                <Sparkles size={22} color={ConnectColors.brand} strokeWidth={2} />
              </Pressable>
              <Pressable
                style={styles.composerIconBtn}
                accessibilityLabel="Share approximate location"
                onPress={() => onSend('location', APPROX_LOCATION, APPROX_LOCATION)}
              >
                <MapPin size={22} color={ConnectColors.brand} strokeWidth={2} />
              </Pressable>

              <View style={styles.inputWrap}>
                <View style={styles.input}>
                  <TextDraft value={draft} onChangeText={setDraft} />
                </View>
              </View>

              <Pressable
                style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.sendBtnDisabled]}
                disabled={!draft.trim() || send.isPending}
                accessibilityLabel="Send message"
                onPress={() => onSend('text')}
              >
                <Send size={20} color={Colors.onPrimary} strokeWidth={2.2} />
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

// Lightweight inline text input (composer needs a bare multiline TextInput, not
// the bordered TextInputField wrapper).
function TextDraft({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="Message…"
      placeholderTextColor={Colors.outline}
      style={styles.textInput}
      multiline
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm,
    backgroundColor: Colors.background,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerAvatar: { width: 38, height: 38, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  headerAvatarFallback: { backgroundColor: Colors.surfaceContainerHigh },
  headerName: { flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  headerStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: ConnectColors.ok },
  headerStatus: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  messages: { padding: Spacing.md, gap: Spacing.sm, flexGrow: 1 },
  emptyThread: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xxl },
  emptyThreadText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },

  systemWrap: { alignItems: 'center', paddingVertical: Spacing.xs },
  systemText: {
    ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center',
    backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full, overflow: 'hidden',
  },

  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg, gap: 4 },
  bubbleMine: { backgroundColor: ConnectColors.brand, borderBottomRightRadius: Radius.sm },
  bubbleTheirs: { backgroundColor: Colors.surfaceContainerLowest, borderBottomLeftRadius: Radius.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  bubbleIcebreaker: { borderWidth: 1, borderColor: ConnectColors.brand },
  icebreakerTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  icebreakerTagText: { ...Typography.caption, color: ConnectColors.brand, fontWeight: '700' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bubbleText: { ...Typography.bodyMd, color: Colors.onSurface },
  bubbleTextMine: { color: Colors.onPrimary },
  bubbleTime: { ...Typography.caption, color: Colors.onSurfaceVariant, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: Colors.inversePrimary },

  sendError: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xs },
  sendErrorText: { ...Typography.labelSm, color: Colors.error },

  lockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    margin: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  lockText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.background,
  },
  composerIconBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1 },
  input: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md, minHeight: 44, justifyContent: 'center',
  },
  textInput: { ...Typography.bodyMd, color: Colors.onSurface, paddingVertical: Spacing.sm, maxHeight: 120 },
  sendBtn: {
    width: 44, height: 44, borderRadius: Radius.full, backgroundColor: ConnectColors.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
