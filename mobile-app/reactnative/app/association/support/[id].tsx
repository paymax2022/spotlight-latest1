import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Send, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useTicket, useReplyTicket } from '@/features/association/hooks/useSettings';
import { TICKET_STATUS_STYLE, TICKET_CATEGORY_LABEL } from '@/features/association/constants/support.constants';
import type { TicketMessage } from '@/features/association/types/settings.types';

export default function TicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticket = useTicket(id);
  const reply = useReplyTicket(id as string);
  const [draft, setDraft] = useState('');

  if (ticket.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Ticket" />
        <StateView kind="loading" message="Loading ticket…" />
      </SafeAreaView>
    );
  }
  if (ticket.isError || !ticket.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Ticket" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => ticket.refetch()} />
      </SafeAreaView>
    );
  }

  const t = ticket.data;
  const st = TICKET_STATUS_STYLE[t.status];
  const resolved = t.status === 'RESOLVED';

  const onSend = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    reply.mutate(body);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ticket" subtitle={TICKET_CATEGORY_LABEL[t.category]} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <FlatList
          data={t.messages}
          keyExtractor={(m) => m.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.headerCard}>
              <Text style={styles.subject}>{t.subject}</Text>
              <View style={[styles.pill, { backgroundColor: st.bg }]}>
                <View style={[styles.dot, { backgroundColor: st.color }]} />
                <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
              </View>
            </View>
          }
          renderItem={({ item }: { item: TicketMessage }) => (
            <View style={[styles.msgWrap, item.fromSupport ? styles.msgOther : styles.msgMine]}>
              <View style={[styles.bubble, item.fromSupport ? styles.bubbleOther : styles.bubbleMine]}>
                {item.fromSupport ? <Text style={styles.author}>{item.author}</Text> : null}
                <Text style={[styles.body, !item.fromSupport && styles.bodyMine]}>{item.body}</Text>
              </View>
            </View>
          )}
        />

        {resolved ? (
          <View style={styles.resolvedBar}>
            <CheckCircle2 size={16} color={Colors.teal} strokeWidth={2.2} />
            <Text style={styles.resolvedText}>This ticket is resolved.</Text>
          </View>
        ) : (
          <View style={styles.composer}>
            <TextInput style={styles.input} placeholder="Reply…" placeholderTextColor={Colors.outline} value={draft} onChangeText={setDraft} multiline accessibilityLabel="Reply" />
            <Pressable onPress={onSend} disabled={!draft.trim() || reply.isPending} style={[styles.sendBtn, (!draft.trim() || reply.isPending) && styles.sendDisabled]} accessibilityRole="button" accessibilityLabel="Send reply">
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
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, gap: Spacing.xs },
  headerCard: { gap: Spacing.sm, paddingBottom: Spacing.md },
  subject: { ...Typography.titleMd, color: Colors.onSurface },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  pillText: { ...Typography.caption, fontWeight: '600' as const },
  msgWrap: { maxWidth: '85%', marginVertical: 3 },
  msgMine: { alignSelf: 'flex-end' },
  msgOther: { alignSelf: 'flex-start' },
  bubble: { borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: Colors.primary, borderTopRightRadius: Radius.sm },
  bubbleOther: { backgroundColor: Colors.surfaceContainerHigh, borderTopLeftRadius: Radius.sm },
  author: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  body: { ...Typography.bodyMd, color: Colors.onSurface },
  bodyMine: { color: Colors.onPrimary },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingTop: 12, paddingBottom: 12, ...Typography.bodyMd, color: Colors.onSurface },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  resolvedBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  resolvedText: { ...Typography.labelMd, color: Colors.teal },
});
