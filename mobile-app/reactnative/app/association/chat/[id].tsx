import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Send, Lock, CreditCard, Search, Bell, BellOff, ImagePlus, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MessageBubble from '@/features/association/components/MessageBubble';
import { useChatThread, useSendMessage, useMuteThread, useReactMessage } from '@/features/association/hooks/useChat';
import { pickDocument } from '@/features/association/utils/docPicker';
import { POSTING_BLOCK_NOTICE, CHAT_SCOPE_LABEL } from '@/features/association/constants/chat.constants';
import type { ChatMessage } from '@/features/association/types/chat.types';

export default function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const thread = useChatThread(id);
  const send = useSendMessage(id as string);
  const mute = useMuteThread(id as string);
  const react = useReactMessage(id as string);
  const [draft, setDraft] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const t = thread.data;
  const messages = useMemo(() => {
    const all = t?.messages ?? [];
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((m) => m.body.toLowerCase().includes(q));
  }, [t?.messages, query]);

  if (thread.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Chat" />
        <StateView kind="loading" message="Loading messages…" />
      </SafeAreaView>
    );
  }
  if (thread.isError || !t) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Chat" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => thread.refetch()} />
      </SafeAreaView>
    );
  }

  const isGroup = t.scope !== 'DIRECT';
  const blocked = t.postingBlock;

  const onSend = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    send.mutate({ body });
  };

  const onAttach = async () => {
    const file = await pickDocument();
    if (file) send.mutate({ body: '', imageUrl: file.uri });
  };

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const prev = messages[index - 1];
    const showAuthor = isGroup && (!prev || prev.authorId !== item.authorId || prev.system);
    return (
      <MessageBubble
        message={item}
        showAuthor={showAuthor}
        onReact={item.system ? undefined : (emoji) => react.mutate({ messageId: item.id, emoji })}
      />
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={t.title}
        subtitle={isGroup ? `${CHAT_SCOPE_LABEL[t.scope]} · ${t.memberCount.toLocaleString('en-NG')} members` : 'Direct message'}
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable onPress={() => { setSearchOpen((s) => !s); setQuery(''); }} hitSlop={8} accessibilityLabel="Search messages">
              <Search size={20} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => mute.mutate(!t.muted)} hitSlop={8} accessibilityLabel={t.muted ? 'Unmute' : 'Mute'}>
              {t.muted ? <BellOff size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /> : <Bell size={20} color={Colors.onSurface} strokeWidth={2} />}
            </Pressable>
          </View>
        }
      />

      {searchOpen ? (
        <View style={styles.searchBar}>
          <Search size={16} color={Colors.outline} strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search in conversation…"
            placeholderTextColor={Colors.outline}
            value={query}
            onChangeText={setQuery}
            autoFocus
            accessibilityLabel="Search input"
          />
          {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><X size={16} color={Colors.outline} /></Pressable> : null}
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ListEmptyComponent={query ? <StateView kind="empty" compact icon="Search" title="No matches" message={`Nothing matches “${query}”.`} /> : null}
        />

        {/* Composer / posting block */}
        {blocked ? (
          <View style={styles.blockBar}>
            <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.blockText}>{POSTING_BLOCK_NOTICE[blocked]}</Text>
            {blocked === 'PAYMENT_RESTRICTED' ? (
              <Pressable style={styles.payBtn} onPress={() => router.push('/association/dues')} accessibilityRole="button" accessibilityLabel="Pay dues">
                <CreditCard size={14} color={Colors.onPrimary} strokeWidth={2.2} />
                <Text style={styles.payText}>Pay</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.composer}>
            <Pressable onPress={onAttach} disabled={send.isPending} style={styles.attachBtn} accessibilityRole="button" accessibilityLabel="Attach image">
              <ImagePlus size={20} color={Colors.primary} strokeWidth={2} />
            </Pressable>
            <TextInput
              style={styles.input}
              placeholder="Message…"
              placeholderTextColor={Colors.outline}
              value={draft}
              onChangeText={setDraft}
              multiline
              accessibilityLabel="Message input"
            />
            <Pressable
              onPress={onSend}
              disabled={!draft.trim() || send.isPending}
              style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.sendBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <Send size={18} color={Colors.onPrimary} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, height: 44,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  attachBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, maxHeight: 120, minHeight: 44,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, paddingTop: 12, paddingBottom: 12,
    ...Typography.bodyMd, color: Colors.onSurface,
  },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  blockBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  blockText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  payBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  payText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' as const },
});
