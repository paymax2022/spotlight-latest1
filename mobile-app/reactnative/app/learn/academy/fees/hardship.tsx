import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LifeBuoy, UserCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import Chip from '@/features/academy/components/Chip';
import { formatDate } from '@/features/academy/constants';
import { HARDSHIP_STATUS_META } from '@/features/academy/fees/constants';
import { useHardshipRequests, useSubmitHardship, useInvoices } from '@/features/academy/fees/hooks';
import type { HardshipRequest } from '@/features/academy/fees/types';

const RELIEF_OPTIONS: { value: HardshipRequest['requestedRelief']; label: string }[] = [
  { value: 'installments', label: 'Split into installments' },
  { value: 'extension', label: 'More time to pay' },
  { value: 'partial_waiver', label: 'Partial fee waiver' },
  { value: 'scholarship_referral', label: 'Scholarship referral' },
];

/** PA-10 — Hardship request. SF-9: routed to human review, never auto-decisioned. */
export default function HardshipRequestScreen() {
  const requests = useHardshipRequests();
  const invoices = useInvoices();
  const submit = useSubmitHardship();

  const [invoiceLabel, setInvoiceLabel] = useState('');
  const [reliefLabel, setReliefLabel] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const openInvoices = (invoices.data ?? []).filter((i) => i.totalKobo - i.paidKobo > 0);
  const invoiceOptions = openInvoices.map((i) => `${i.childName} · ${i.term} (${i.reference})`);

  const canSubmit = !!invoiceLabel && !!reliefLabel && reason.trim().length >= 4;

  const onSubmit = () => {
    const inv = openInvoices.find((i) => `${i.childName} · ${i.term} (${i.reference})` === invoiceLabel);
    const relief = RELIEF_OPTIONS.find((r) => r.label === reliefLabel);
    if (!inv || !relief) return;
    submit.mutate(
      { invoiceId: inv.id, requestedRelief: relief.value, reason: reason.trim(), note: note.trim() },
      {
        onSuccess: () => {
          setInvoiceLabel(''); setReliefLabel(''); setReason(''); setNote('');
          Alert.alert('Request sent', 'Your request has been sent to the school fees office for review. They will respond here.');
        },
        onError: (e) => Alert.alert('Could not submit', (e as Error).message),
      },
    );
  };

  if (requests.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Hardship help" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Hardship help" subtitle="PA-10 · Human review" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.intro, shadow1]}>
          <View style={styles.introIcon}><LifeBuoy size={22} color={Colors.secondary} /></View>
          <Text style={styles.introText}>
            Struggling with fees? Tell the school. A person reviews every request — nothing is decided automatically, and your child's learning is never interrupted.
          </Text>
        </View>

        {/* New request */}
        <Text style={styles.section}>New request</Text>
        <View style={styles.form}>
          <SelectField label="Invoice" placeholder="Which invoice?" value={invoiceLabel} options={invoiceOptions} onChange={setInvoiceLabel} />
          <SelectField label="What would help?" placeholder="Select relief" value={reliefLabel} options={RELIEF_OPTIONS.map((r) => r.label)} onChange={setReliefLabel} searchable={false} />
          <TextInputField label="Reason (short)" placeholder="e.g. Reduced income this quarter" value={reason} onChangeText={setReason} />
          <TextInputField label="Details (optional)" placeholder="Anything the school should know…" value={note} onChangeText={setNote} multiline numberOfLines={3} style={styles.multiline} />
          <PrimaryButton label="Send request" onPress={onSubmit} loading={submit.isPending} disabled={!canSubmit} />
        </View>

        {/* Existing requests */}
        {(requests.data ?? []).length ? (
          <>
            <Text style={styles.section}>Your requests</Text>
            {requests.data!.map((h) => <RequestRow key={h.id} h={h} />)}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function RequestRow({ h }: { h: HardshipRequest }) {
  const meta = HARDSHIP_STATUS_META[h.status];
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.reqTop}>
        <Text style={styles.reqSchool} numberOfLines={1}>{h.schoolName}</Text>
        <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
      </View>
      <Text style={styles.reqMeta}>{h.childName} · {formatDate(h.submittedAt)}</Text>
      <Text style={styles.reqReason}>{h.reason}</Text>
      {h.responseNote ? (
        <View style={styles.response}>
          <UserCheck size={14} color={Colors.teal} />
          <Text style={styles.responseText}>{h.responseNote}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  intro: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md },
  introIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLowest },
  introText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  form: { gap: Spacing.sm },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 4 },
  reqTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  reqSchool: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  reqMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  reqReason: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 2 },
  response: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.sm, marginTop: Spacing.xs },
  responseText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
