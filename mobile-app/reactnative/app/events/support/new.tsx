import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CommerceNotice from '@/features/events/components/CommerceNotice';
import { useOpenSupportCase, useEvent } from '@/features/events/hooks';
import { SUPPORT_KINDS, SUPPORT_KIND_LABEL, parseSupportKind } from '@/features/events/support';
import { EventColors, EVENTS_COMMERCE_ENABLED } from '@/features/events/constants/events.constants';
import type { SupportCaseKind } from '@/features/events/types';

// Server caps (support_service.go): subject 200, body 4000.
const MAX_SUBJECT = 200;
const MAX_BODY = 4000;

export default function OpenSupportCase() {
  const params = useLocalSearchParams<{ eventId?: string; ticketId?: string; orderId?: string; kind?: string }>();
  const { data: event } = useEvent(params.eventId ?? '');
  const open = useOpenSupportCase();
  const [kind, setKind] = useState<SupportCaseKind>(parseSupportKind(params.kind) ?? 'TICKET');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (!EVENTS_COMMERCE_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New support case" backFallback="/events/support" />
        <CommerceNotice />
      </SafeAreaView>
    );
  }

  const submit = async () => {
    setErr(null);
    const s = subject.trim();
    const b = body.trim();
    if (s.length < 3) { setErr('Add a short subject.'); return; }
    if (b.length < 10) { setErr('Describe what happened so the desk can help.'); return; }
    try {
      const c = await open.mutateAsync({
        kind,
        subject: s.slice(0, MAX_SUBJECT),
        body: b.slice(0, MAX_BODY),
        event_id: params.eventId || undefined,
        ticket_id: params.ticketId || undefined,
        order_id: params.orderId || undefined,
      });
      router.replace({ pathname: '/events/support/[caseId]', params: { caseId: c.id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open the case. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New support case" subtitle={event?.title} backFallback="/events/support" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>What is it about?</Text>
        <View style={styles.chips}>
          {SUPPORT_KINDS.map((k) => {
            const active = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{SUPPORT_KIND_LABEL[k]}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInputField label="Subject" placeholder="e.g. Charged twice for one ticket" value={subject} onChangeText={setSubject} maxLength={MAX_SUBJECT} />
        <TextInputField label="Details" placeholder="What happened, and when?" value={body} onChangeText={setBody} multiline maxLength={MAX_BODY} error={err ?? undefined} />
        {params.ticketId || params.eventId ? (
          <Text style={styles.hint}>This case is linked to {params.ticketId ? 'your ticket' : 'the event'}, so the organiser and desk can see the context.</Text>
        ) : null}
        <PrimaryButton label="Send to support" onPress={submit} loading={open.isPending} disabled={!subject.trim() || !body.trim()} />
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipActive: { backgroundColor: EventColors.brand, borderColor: EventColors.brand },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
  hint: { ...Typography.bodySm, color: EventColors.muted },
});
