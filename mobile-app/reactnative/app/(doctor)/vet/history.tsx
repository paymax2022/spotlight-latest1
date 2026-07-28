import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { History, PawPrint, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, StatusBadge } from '@/features/doctor/components';
import { useVetConsultHistory } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS, VET_CONSULT_TYPE_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';

// Vet consultation history (S.22) — past pet consults; each row opens its summary.
export default function VetConsultHistoryScreen() {
  const { data: history = [], isLoading, isError, refetch, isPlaceholderData } = useVetConsultHistory();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Consultation History" />

      {isLoading && isPlaceholderData ? (
        <StateView variant="loading" label="Loading history" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your consultation history." onRetry={() => refetch()} />
      ) : history.length === 0 ? (
        <StateView variant="empty" icon={History} title="No past consults" message="Completed pet consultations will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.list}>
            {history.map((h) => (
              <Pressable
                key={h.id}
                style={styles.row}
                onPress={() => router.push(`/(doctor)/vet/consult/${h.id}/summary`)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${h.petName} consultation summary`}
              >
                <View style={styles.icon}>
                  <PawPrint size={18} color={Colors.primary} strokeWidth={2} />
                </View>
                <View style={styles.body}>
                  <Text style={styles.name} numberOfLines={1}>{h.petName}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{PET_SPECIES_LABELS[h.petSpecies]} - {h.ownerName}</Text>
                  <Text style={styles.summary} numberOfLines={1}>{h.summary}</Text>
                </View>
                <View style={styles.right}>
                  <StatusBadge label={VET_CONSULT_TYPE_LABELS[h.consultType]} tone="info" />
                  <Text style={styles.date}>{new Date(h.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text>
                  <Text style={styles.fee}>{formatKobo(h.feeKobo)}</Text>
                </View>
                <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  list:    { gap: Spacing.sm },
  row:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  icon:    { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  body:    { flex: 1, gap: 2 },
  name:    { ...Typography.labelLg, color: Colors.onSurface },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  right:   { alignItems: 'flex-end', gap: 2 },
  date:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  fee:     { ...Typography.labelSm, color: Colors.teal },
});
