import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StatusPill, { pillFor } from '@/features/events/components/StatusPill';
import CommerceNotice from '@/features/events/components/CommerceNotice';
import { useSupportCase, useReplySupportCase } from '@/features/events/hooks';
import { SUPPORT_KIND_LABEL, canReplyToCase } from '@/features/events/support';
import { EventColors, SUPPORT_STATE_BADGE, EVENTS_COMMERCE_ENABLED } from '@/features/events/constants/events.constants';
import type { SupportMessage } from '@/features/events/types';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SupportCaseThread() {
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const { data: c, isLoading, isError, refetch, isRefetching } = useSupportCase(caseId ?? '');
  const reply = useReplySupportCase(caseId ?? '');
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (!EVENTS_COMMERCE_ENABLED) return <Shell><CommerceNotice /></Shell>;
  if (isLoading) return <Shell><StateView kind="loading" message="Loading case…" /></Shell>;
  if (isError || !c) return <Shell><StateView kind="error" title="Case not found" message="It may belong to another account." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const pill = pillFor(SUPPORT_STATE_BADGE, c.status);
  const messages = c.messages ?? [];
  const canReply = canReplyToCase(String(c.status));

  const send = async () => {
    setErr(null);
    const body = draft.trim();
    if (!body) return;
    try {
      await reply.mutateAsync(body);
      setDraft('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Reply not sent. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Support case" subtitle={SUPPORT_KIND_LABEL[c.kind] ?? c.kind} backFallback="/events/support" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          <View style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.title}>{c.subject}</Text>
              {pill ? <StatusPill {...pill} /> : null}
            </View>
            {c.event_title ? <Text style={styles.sub}>{c.event_title}</Text> : null}
            <Text style={styles.sub}>Opened {when(c.created_at)}</Text>
            <Text style={styles.body}>{c.body}</Text>
          </View>

          {messages.length === 0 ? (
            <Text style={styles.hint}>No replies yet. The organiser or our desk will answer here, and you'll get a notification.</Text>
          ) : messages.map((m) => <Bubble key={m.id} m={m} mine={m.author_id === c.opened_by} />)}
          <View style={{ height: Spacing.lg }} />
        </ScrollView>

        <View style={styles.composer}>
          {canReply ? (
            <>
              <TextInputField placeholder="Write a reply" value={draft} onChangeText={setDraft} multiline maxLength={4000} error={err ?? undefined} />
              <PrimaryButton label="Send reply" onPress={send} loading={reply.isPending} disabled={!draft.trim()} />
            </>
          ) : (
            <>
              <Text style={styles.hint}>This case is closed. Open a new one if you still need help.</Text>
              <PrimaryButton
                label="Open a new case"
                variant="secondary"
                onPress={() => router.push({ pathname: '/events/support/new', params: { eventId: c.event_id ?? '', ticketId: c.ticket_id ?? '', kind: String(c.kind) } })}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ m, mine }: { m: SupportMessage; mine: boolean }) {
  return (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
      <Text style={styles.author}>{mine ? 'You' : (m.author_name || 'Support')} · {when(m.created_at)}</Text>
      <Text style={styles.body}>{m.body}</Text>
    </View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Support case" backFallback="/events/support" />{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs, ...shadow1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  sub: { ...Typography.bodySm, color: EventColors.muted },
  body: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 2 },
  hint: { ...Typography.bodySm, color: EventColors.muted, textAlign: 'center' },
  bubble: { maxWidth: '88%', borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: EventColors.surfaceAlt },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: EventColors.surface, ...shadow1 },
  author: { ...Typography.caption, color: EventColors.muted },
  composer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
