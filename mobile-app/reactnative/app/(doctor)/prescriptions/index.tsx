import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ClipboardList, Pill, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView } from '@/features/doctor/components';
import { usePrescriptions } from '@/features/doctor/hooks';
import type { DoctorPrescription } from '@/types/doctor';

const STATUS_COLOR: Record<DoctorPrescription['status'], { fg: string; bg: string }> = {
  draft:     { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow },
  issued:    { fg: Colors.secondary,        bg: Colors.iconBgBlue },
  dispensed: { fg: Colors.teal,             bg: Colors.iconBgTeal },
};

export default function PrescriptionsScreen() {
  const { data: prescriptions = [], isLoading, isError, refetch } = usePrescriptions();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Prescriptions" />

      {isLoading && prescriptions.length === 0 ? (
        <StateView variant="loading" label="Loading prescriptions" />
      ) : isError ? (
        <StateView variant="error" message="We could not load prescriptions." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {prescriptions.length === 0 ? (
            <StateView variant="empty" icon={ClipboardList} title="No prescriptions yet" message="Prescriptions you issue will appear here." />
          ) : (
            prescriptions.map((rx) => <PrescriptionItem key={rx.id} rx={rx} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PrescriptionItem({ rx }: { rx: DoctorPrescription }) {
  const colors = STATUS_COLOR[rx.status];
  const date = new Date(rx.issuedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  // K30 — tap an issued/dispensed rx to open the issued detail (QR / send / audit).
  const canOpen = rx.status === 'issued' || rx.status === 'dispensed';
  return (
    <Pressable
      onPress={() => canOpen && router.push(`/(doctor)/prescriptions/${rx.id}/issued`)}
      disabled={!canOpen}
      accessibilityRole={canOpen ? 'button' : undefined}
      accessibilityLabel={`Prescription ${rx.ref} for ${rx.patient.name}`}
    >
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <DoctorAvatar initials={rx.patient.initials} color={rx.patient.avatarColor} size={44} />
        <View style={styles.headerBody}>
          <Text style={styles.patient} numberOfLines={1}>{rx.patient.name}</Text>
          <Text style={styles.ref} numberOfLines={1}>{rx.ref} · {date}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: colors.bg }]}>
          <Text style={[styles.statusText, { color: colors.fg }]}>{rx.status}</Text>
        </View>
        {canOpen && <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
      </View>

      <Text style={styles.diagnosis}>{rx.diagnosis}</Text>

      {rx.items.map((item, i) => (
        <View key={i} style={[styles.item, i > 0 && styles.itemBorder]}>
          <Pill size={16} color={Colors.primary} strokeWidth={2} />
          <View style={styles.itemBody}>
            <Text style={styles.itemName}>{item.name} {item.dosage}</Text>
            <Text style={styles.itemMeta}>{item.route} · {item.frequency} · {item.duration}</Text>
            {!!item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}
          </View>
        </View>
      ))}
    </SectionCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md, flexGrow: 1 },
  card:        {},
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  headerBody:  { flex: 1, gap: 2 },
  patient:     { ...Typography.titleMd, color: Colors.onSurface },
  ref:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  statusPill:  { height: 24, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  statusText:  { ...Typography.labelSm, fontWeight: '700', textTransform: 'capitalize' },
  diagnosis:   { ...Typography.labelMd, color: Colors.primary, marginBottom: Spacing.sm },
  item:        { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  itemBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  itemBody:    { flex: 1, gap: 2 },
  itemName:    { ...Typography.labelLg, color: Colors.onSurface },
  itemMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  itemNotes:   { ...Typography.caption, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
});
