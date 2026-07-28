import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ClipboardList, ChevronRight, RotateCcw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import { useIssuedPetPrescription } from '@/features/doctor/hooks';
import { PET_RX_SEND_STATUS_LABELS, PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { StatusTone } from '@/features/doctor/components';
import type { PetRxSendStatus } from '@/types/doctor.batch5';

const SEND_TONE: Record<PetRxSendStatus, StatusTone> = {
  not_sent: 'neutral', sending: 'warning', sent: 'info', received: 'brand', dispensed: 'success', failed: 'danger',
};

// Pet prescription history (T.12). The contract exposes a single issued-Rx read,
// so this lists the most recent issued prescription (demo placeholder) and links
// to its issued detail + the refill queue.
export default function PetPrescriptionsScreen() {
  const { data: issued, isLoading, isError, refetch } = useIssuedPetPrescription('latest');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Prescriptions" />

      {isLoading && !issued ? (
        <StateView variant="loading" label="Loading prescriptions" />
      ) : isError ? (
        <StateView variant="error" message="We could not load prescriptions." onRetry={() => refetch()} />
      ) : !issued ? (
        <StateView variant="empty" icon={ClipboardList} title="No prescriptions" message="Issued pet prescriptions will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <SectionCard title="Recent" style={styles.card}>
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/(doctor)/vet/pet/${issued.prescription.petId}/prescription/issue?prescriptionId=${issued.prescription.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${issued.prescription.ref}`}
            >
              <View style={styles.icon}><ClipboardList size={18} color={Colors.primary} strokeWidth={2} /></View>
              <View style={styles.body}>
                <Text style={styles.ref}>{issued.prescription.ref}</Text>
                <Text style={styles.meta} numberOfLines={1}>{issued.prescription.petName} ({PET_SPECIES_LABELS[issued.prescription.petSpecies]}) - {issued.prescription.items.length} item(s)</Text>
                <Text style={styles.diag} numberOfLines={1}>{issued.prescription.diagnosis}</Text>
              </View>
              <View style={styles.right}>
                <StatusBadge label={PET_RX_SEND_STATUS_LABELS[issued.sendStatus]} tone={SEND_TONE[issued.sendStatus]} />
                <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </View>
            </Pressable>
          </SectionCard>

          <Pressable style={styles.refillLink} onPress={() => router.push('/(doctor)/vet/refills')} accessibilityRole="button" accessibilityLabel="Open refill requests">
            <View style={[styles.icon, { backgroundColor: Colors.iconBgBlue }]}><RotateCcw size={18} color={Colors.secondary} strokeWidth={2} /></View>
            <Text style={styles.refillLabel}>Refill requests</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:        { marginBottom: Spacing.md },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  icon:        { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  body:        { flex: 1, gap: 2 },
  ref:         { ...Typography.labelLg, color: Colors.onSurface },
  meta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  diag:        { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  right:       { alignItems: 'flex-end', gap: 4 },
  refillLink:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  refillLabel: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
});
