import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useTicket, useReplyTicket } from '@/features/crowdfunding/hooks/useExtras';
import { relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { TicketStatus } from '@/features/crowdfunding/types/crowdfunding.types';

const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Open', PENDING: 'Awaiting reply', RESOLVED: 'Resolved', CLOSED: 'Closed' };

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, isLoading, isError, refetch } = useTicket(id);
  const reply = useReplyTicket(id);
  const [text, setText] = useState('');

  const send = () => {
    if (!text.trim()) return;
    reply.mutate(text.trim());
    setText('');
  };

  const resolved = t?.status === 'RESOLVED' || t?.status === 'CLOSED';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t?.reference ?? 'Ticket'} subtitle={t ? STATUS_LABEL[t.status] : undefined} />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !t ? (
        <StateView kind="error" title="Couldn't load ticket" actionLabel="Retry" onAction={refetch} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
          <FlatList
            data={t.messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messages}
            ListHeaderComponent={<Text style={styles.subject}>{t.subject}</Text>}
            renderItem={({ item }) => {
              const mine = item.from === 'user';
              return (
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowThem]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleThem]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{relativeTime(item.createdAt)}</Text>
                  </View>
                </View>
              );
            }}
          />

          {resolved ? (
            <View style={styles.resolvedBar}><Text style={styles.resolvedText}>This ticket is {t.status.toLowerCase()}. Reply to reopen it.</Text></View>
          ) : null}

          <View style={styles.inputBar}>
            <TextInput style={styles.input} placeholder="Type a reply…" placeholderTextColor={Colors.outline} value={text} onChangeText={setText} multiline />
            <Pressable style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]} onPress={send} disabled={!text.trim() || reply.isPending} accessibilityLabel="Send reply">
              <Send size={18} color={Colors.onPrimary} strokeWidth={2} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  messages: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.sm },
  subject: { ...Typography.titleMd, color: Colors.onSurface, marginVertical: Spacing.md, textAlign: 'center' },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowThem: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: Radius.sm },
  bubbleThem: { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderBottomLeftRadius: Radius.sm },
  bubbleText: { ...Typography.bodyMd, color: Colors.onSurface },
  bubbleTextMine: { color: Colors.onPrimary },
  bubbleTime: { ...Typography.caption, color: Colors.onSurfaceVariant },
  bubbleTimeMine: { color: Colors.inversePrimary },
  resolvedBar: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, backgroundColor: Colors.surfaceContainerLow },
  resolvedText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background },
  input: { flex: 1, maxHeight: 120, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Typography.bodyMd, color: Colors.onSurface },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
});
