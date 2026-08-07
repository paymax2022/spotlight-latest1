import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { router } from 'expo-router';
import { ShieldCheck, ChevronRight, Plus, FileCheck, MessageSquare, X, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import { formatKobo } from '@/api/doctor.phase2.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useHmoClaims, useSubmitClaim } from '@/features/doctor/hooks';
import { CLAIM_STATUS_LABELS, HMO_PROVIDER_OPTIONS } from '@/features/doctor/constants';
import type { HmoClaim, ClaimStatus, ClaimLineItem } from '@/types/doctor.phase2';

const STATUS_TONE: Record<ClaimStatus, StatusTone> = {
  submitted:    'neutral',
  under_review: 'info',
  approved:     'brand',
  rejected:     'danger',
  disputed:     'warning',
  paid:         'success',
};

// O14 / O15 / O16 — claim status filter (statuses are STATES of one list).
const FILTERS: { value?: ClaimStatus; label: string }[] = [
  { value: undefined,      label: 'All' },
  { value: 'under_review', label: 'Under review' },
  { value: 'approved',     label: 'Approved' },
  { value: 'rejected',     label: 'Rejected' },
  { value: 'paid',         label: 'Paid' },
];

export default function ClaimsScreen() {
  const [filter, setFilter] = useState<ClaimStatus | undefined>(undefined);
  const { data: claims = [], isLoading, isError, refetch } = useHmoClaims(filter);
  const submit = useSubmitClaim();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="HMO Claims"
        right={
          <Pressable onPress={() => setPreviewOpen(true)} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="New claim">
            <Plus size={20} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {/* HMO tools */}
      <View style={styles.tools}>
        <Pressable style={styles.toolBtn} onPress={() => router.push('/(doctor)/hmo/pre-auth')} accessibilityRole="button" accessibilityLabel="Pre-authorisation">
          <FileCheck size={16} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.toolText}>Pre-auth</Text>
        </Pressable>
        <Pressable style={styles.toolBtn} onPress={() => router.push('/(doctor)/hmo/support')} accessibilityRole="button" accessibilityLabel="HMO support">
          <MessageSquare size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.toolText}>Support</Text>
        </Pressable>
      </View>

      {/* Status filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <Pressable key={f.label} onPress={() => setFilter(f.value)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityLabel={`Filter ${f.label}`}>
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading && claims.length === 0 ? (
        <StateView variant="loading" label="Loading claims" />
      ) : isError ? (
        <StateView variant="error" message="We could not load claims." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {claims.length === 0 ? (
            <StateView variant="empty" icon={ShieldCheck} title="No claims" message="HMO claims you submit will appear here." />
          ) : (
            claims.map((c) => <ClaimRow key={c.id} claim={c} />)
          )}
        </ScrollView>
      )}

      {/* O13 — claim submission preview sheet */}
      <SubmitSheet
        visible={previewOpen}
        pending={submit.isPending}
        onClose={() => setPreviewOpen(false)}
        onSubmit={async (input) => {
          try {
            const result = await submit.mutateAsync(input);
            setPreviewOpen(false);
            const ok = await confirmAsync({ title: 'Claim submitted', message: `${result.ref} has been submitted.`, confirmLabel: 'View', cancelLabel: 'Done' });
            if (ok) { router.push(`/(doctor)/claims/${result.claimId}`); }
          } catch {
            alertAsync({ title: 'Failed', message: 'Could not submit the claim. Please try again.' });
          }
        }}
      />
    </SafeAreaView>
  );
}

function ClaimRow({ claim }: { claim: HmoClaim }) {
  const date = new Date(claim.submittedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/(doctor)/claims/${claim.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Claim ${claim.ref} for ${claim.patient.name}`}
    >
      <DoctorAvatar initials={claim.patient.initials} color={claim.patient.avatarColor} size={44} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{claim.patient.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{claim.ref} · {claim.provider}</Text>
        <Text style={styles.amount} numberOfLines={1}>{formatKobo(claim.claimedKobo)} claimed · {date}</Text>
      </View>
      <View style={styles.right}>
        <StatusBadge label={CLAIM_STATUS_LABELS[claim.status]} tone={STATUS_TONE[claim.status]} />
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

function SubmitSheet({ visible, pending, onClose, onSubmit }: {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { appointmentId: string; provider: string; lineItems: ClaimLineItem[] }) => void;
}) {
  const [provider, setProvider] = useState('');
  const [description, setDescription] = useState('');
  const [naira, setNaira] = useState('');

  const amountKobo = Math.round((Number(naira) || 0) * 100);
  const canSubmit = !!provider && description.trim().length > 0 && amountKobo > 0;
  const lineItems: ClaimLineItem[] = canSubmit ? [{ description: description.trim(), amountKobo, covered: true }] : [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Submit claim</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <SelectField label="Provider" placeholder="Select provider" value={provider} options={HMO_PROVIDER_OPTIONS} onChange={setProvider} />
          <TextInputField label="Service / line item" value={description} onChangeText={setDescription} placeholder="e.g. Teleconsultation" />
          <TextInputField label="Amount (NGN)" value={naira} onChangeText={(v) => setNaira(sanitizeMoneyInput(v))} keyboardType="decimal-pad" maxLength={13} placeholder="e.g. 8000" />
          {canSubmit && (
            <View style={styles.previewBox}>
              <View style={styles.previewRow}>
                <Check size={14} color={Colors.teal} strokeWidth={2.5} />
                <Text style={styles.previewText}>{description.trim()}</Text>
                <Text style={styles.previewAmt}>{formatKobo(amountKobo)}</Text>
              </View>
            </View>
          )}
          <PrimaryButton label="Submit claim" onPress={() => onSubmit({ appointmentId: 'apt-1', provider, lineItems })} loading={pending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  addBtn:      { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  tools:       { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  toolBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 44, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  toolText:    { ...Typography.labelMd, color: Colors.onSurface },
  filterRow:   { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  chip:        { height: 36, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  chipOn:      { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:    { ...Typography.labelMd, color: Colors.onSurface },
  chipTextOn:  { color: Colors.onPrimary },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  card:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:        { flex: 1, gap: 2 },
  name:        { ...Typography.titleMd, color: Colors.onSurface },
  meta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  amount:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:       { alignItems: 'flex-end', gap: Spacing.xs },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, maxHeight: '85%' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  previewBox:  { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.md },
  previewRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  previewText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  previewAmt:  { ...Typography.labelMd, color: Colors.onSurface },
  btn:         { marginTop: Spacing.sm },
});
