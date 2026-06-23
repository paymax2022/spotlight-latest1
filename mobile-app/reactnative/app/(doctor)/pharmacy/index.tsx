import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Pill, ChevronRight, Store } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePharmacyFulfilments } from '@/features/doctor/hooks';
import { PHARMACY_STATUS_LABELS } from '@/features/doctor/constants';
import type { PharmacyFulfilment, PharmacyFulfilmentStatus } from '@/types/doctor.phase2';

const STATUS_TONE: Record<PharmacyFulfilmentStatus, StatusTone> = {
  received:             'neutral',
  substitute_requested: 'warning',
  preparing:           'info',
  ready:               'brand',
  dispensed:           'success',
  cancelled:           'danger',
};

export default function PharmacyListScreen() {
  const { data: fulfilments = [], isLoading, isError, refetch } = usePharmacyFulfilments();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pharmacy" />

      {isLoading && fulfilments.length === 0 ? (
        <StateView variant="loading" label="Loading pharmacy requests" />
      ) : isError ? (
        <StateView variant="error" message="We could not load pharmacy requests." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* L3 — pharmacy directory entry point */}
          <Pressable style={styles.directoryCard} onPress={() => router.push('/(doctor)/pharmacy/directory')} accessibilityRole="button" accessibilityLabel="Find a pharmacy">
            <View style={styles.directoryIcon}><Store size={20} color={Colors.primary} strokeWidth={2} /></View>
            <View style={styles.directoryBody}>
              <Text style={styles.directoryTitle}>Find a pharmacy</Text>
              <Text style={styles.directorySub}>Preferred & nearby verified pharmacies</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          {fulfilments.length === 0 ? (
            <StateView variant="empty" icon={Pill} title="No pharmacy requests" message="Fulfilment and substitution requests will appear here." />
          ) : (
            fulfilments.map((f) => <FulfilmentRow key={f.id} fulfilment={f} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function FulfilmentRow({ fulfilment }: { fulfilment: PharmacyFulfilment }) {
  const date = new Date(fulfilment.requestedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/(doctor)/pharmacy/${fulfilment.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Pharmacy request ${fulfilment.ref} for ${fulfilment.patient.name}`}
    >
      <DoctorAvatar initials={fulfilment.patient.initials} color={fulfilment.patient.avatarColor} size={44} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{fulfilment.patient.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{fulfilment.ref} · {fulfilment.pharmacyName}</Text>
        <Text style={styles.meta} numberOfLines={1}>{fulfilment.prescriptionRef} · {date}</Text>
      </View>
      <View style={styles.right}>
        <StatusBadge label={PHARMACY_STATUS_LABELS[fulfilment.status]} tone={STATUS_TONE[fulfilment.status]} />
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  card:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:    { flex: 1, gap: 2 },
  name:    { ...Typography.titleMd, color: Colors.onSurface },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:   { alignItems: 'flex-end', gap: Spacing.xs },
  directoryCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primaryFixed, borderWidth: 1, borderColor: Colors.primaryContainer },
  directoryIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  directoryBody: { flex: 1, gap: 2 },
  directoryTitle: { ...Typography.titleMd, color: Colors.onSurface },
  directorySub: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
