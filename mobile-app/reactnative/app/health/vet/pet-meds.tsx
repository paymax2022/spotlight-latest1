import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Pill, RefreshCw, CalendarClock, ScrollText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMedications, useRequestRefill } from '@/features/health/vet/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

export default function PetMedsScreen() {
  const { petId } = useLocalSearchParams<{ petId?: string }>();
  const { data: meds, isLoading, isError, refetch } = useMedications(petId);
  const requestRefill = useRequestRefill();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pet meds & refills" subtitle="Active medications" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <StateView kind="loading" message="Loading medications…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load medications" actionLabel="Retry" onAction={refetch} compact />
        ) : (meds ?? []).length === 0 ? (
          <StateView
            kind="empty"
            icon="Pill"
            title="No active medications"
            message="Prescribed medications appear here after a consult."
            actionLabel="Find a vet"
            onAction={() => router.push('/health/vet/find-vet')}
            compact
          />
        ) : (
          (meds ?? []).map((m) => {
            const due = new Date(m.nextRefillAt).getTime() <= Date.now();
            return (
              <View key={m.id} style={[styles.card, shadow1]}>
                <View style={styles.head}>
                  <View style={styles.iconBox}>
                    <Pill size={18} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{m.drugName}</Text>
                    <Text style={styles.dose}>{m.dosage} · {m.frequency} · for {m.petName}</Text>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <CalendarClock size={13} color={due ? Colors.error : Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={[styles.metaText, due && styles.metaDue]}>
                      {due ? 'Refill due' : `Next refill ${formatDate(m.nextRefillAt)}`}
                    </Text>
                  </View>
                  <Text style={styles.refills}>{m.refillsRemaining} refill{m.refillsRemaining === 1 ? '' : 's'} left</Text>
                </View>

                <View style={styles.actions}>
                  <Pressable
                    style={styles.refillBtn}
                    onPress={() => requestRefill.mutate(m.id)}
                  >
                    <RefreshCw size={15} color={Colors.white} strokeWidth={2} />
                    <Text style={styles.refillText}>{requestRefill.isPending ? 'Requesting…' : 'Request refill'}</Text>
                  </Pressable>
                  {m.prescriptionId ? (
                    <Pressable
                      style={styles.rxBtn}
                      onPress={() => router.push({ pathname: '/health/vet/eprescription/[id]', params: { id: m.prescriptionId! } })}
                    >
                      <ScrollText size={15} color={Colors.secondary} strokeWidth={2} />
                      <Text style={styles.rxText}>View Rx</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  dose: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaDue: { color: Colors.error, fontWeight: '600' as const },
  refills: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  refillBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 11 },
  refillText: { ...Typography.labelMd, color: Colors.white },
  rxBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingVertical: 11, paddingHorizontal: Spacing.md },
  rxText: { ...Typography.labelMd, color: Colors.secondary },
});
