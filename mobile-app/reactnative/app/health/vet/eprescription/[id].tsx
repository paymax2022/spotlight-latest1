import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Pill, CalendarClock, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import RxItemRow from '@/features/health/vet/components/RxItemRow';
import VetStatusPill from '@/features/health/vet/components/VetStatusPill';
import { usePrescription, useAcknowledgeRecordConsent, useSendRxToPharmacy } from '@/features/health/vet/hooks';
import { RECORD_CONSENT_COPY, RX_HANDOFF_COPY } from '@/features/health/vet/constants';
import { formatDate } from '@/features/health/constants/health.constants';

export default function EPrescriptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rx, isLoading, isError, refetch } = usePrescription(id);
  const ack = useAcknowledgeRecordConsent();
  const sendToPharmacy = useSendRxToPharmacy();
  const [unlocked, setUnlocked] = useState(false);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="e-Prescription" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !rx) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="e-Prescription" />
        <StateView kind="error" title="Couldn't load this prescription" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const gated = rx.sensitive && !unlocked;
  const onUnlock = () => ack.mutate(rx.id, { onSuccess: () => setUnlocked(true) });
  const onSend = () =>
    sendToPharmacy.mutate(rx.id, {
      onSuccess: () => router.push('/health/pharmacy/upload-rx'),
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="e-Prescription" subtitle={`For ${rx.petName}`} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.prescriber}>{rx.vetName}</Text>
              <Text style={styles.sub}>Issued {formatDate(rx.issuedAt)} · Expires {formatDate(rx.expiresAt)}</Text>
            </View>
            <VetStatusPill rx={rx.status} />
          </View>
          <CredentialBadge credential={rx.vetCredential} showLicense />
        </View>

        {gated ? (
          <View style={styles.consentCard}>
            <ShieldCheck size={20} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.consentText}>{RECORD_CONSENT_COPY}</Text>
            <PrimaryButton label="Unlock prescription" onPress={onUnlock} loading={ack.isPending} variant="secondary" />
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Prescribed items</Text>
            <View style={[styles.card, shadow1]}>
              {rx.items.map((it) => (
                <RxItemRow key={it.id} item={it} />
              ))}
            </View>

            {rx.notes ? (
              <View style={styles.notes}>
                <Info size={16} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.notesText}>{rx.notes}</Text>
              </View>
            ) : null}

            {/* Pharmacy handoff (HL-3) */}
            <View style={styles.handoffCard}>
              <Pill size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.handoffText}>{RX_HANDOFF_COPY}</Text>
            </View>
          </>
        )}
      </ScrollView>

      {!gated ? (
        <View style={styles.footer}>
          <PrimaryButton
            label={rx.status === 'SENT_TO_PHARMACY' ? 'Sent to pharmacy · View' : 'Send to pharmacy'}
            onPress={onSend}
            loading={sendToPharmacy.isPending}
            disabled={rx.status === 'DISPENSED' || rx.status === 'EXPIRED'}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  prescriber: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  consentCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, alignItems: 'flex-start' },
  consentText: { ...Typography.bodySm, color: Colors.tertiaryContainer, lineHeight: 18 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  notes: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.md },
  notesText: { ...Typography.bodySm, color: Colors.onSecondaryFixed, flex: 1, lineHeight: 18 },
  handoffCard: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  handoffText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
