import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Syringe, X, Bell } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge, PetVaccinationRow } from '@/features/doctor/components';
import { usePetVaccinationRecommendations, usePetVaccinationReminders, useSetPetVaccinationReminder } from '@/features/doctor/hooks';
import { VACCINATION_REMINDER_CHANNEL_OPTIONS } from '@/features/doctor/constants';
import type { PetVaccinationRecommendation, PetVaccinationReminder } from '@/types/doctor.batch5';

export default function PetVaccinationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);

  const { data: recs = [], isLoading, isError, refetch } = usePetVaccinationRecommendations(petId);
  const { data: reminders = [] } = usePetVaccinationReminders(petId);
  const setReminder = useSetPetVaccinationReminder();

  const [target, setTarget] = useState<PetVaccinationRecommendation | null>(null);
  const [channel, setChannel] = useState<PetVaccinationReminder['channel']>('push');

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

  const saveReminder = async () => {
    if (!target) return;
    try {
      await setReminder.mutateAsync({
        petId,
        vaccineName: target.vaccineName,
        remindAt: target.dueDate,
        channel,
        enabled: true,
      });
      setTarget(null);
      Alert.alert('Reminder set', `You will be reminded about ${target.vaccineName}.`);
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Vaccinations" />

      {isLoading && recs.length === 0 ? (
        <StateView variant="loading" label="Loading recommendations" />
      ) : isError ? (
        <StateView variant="error" message="We could not load vaccination recommendations." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {recs.length === 0 ? (
            <StateView variant="empty" icon={Syringe} title="No recommendations" message="No vaccinations are due for this pet." />
          ) : (
            <SectionCard title="Recommended vaccinations" style={styles.card}>
              {recs.map((r, i) => (
                <View key={r.id} style={i > 0 ? styles.rowBorder : undefined}>
                  <PetVaccinationRow recommendation={r} dueText={fmtDate(r.dueDate)} onSetReminder={() => setTarget(r)} />
                </View>
              ))}
            </SectionCard>
          )}

          {reminders.length > 0 && (
            <SectionCard title="Active reminders" style={styles.card}>
              {reminders.map((rm, i) => (
                <View key={rm.id} style={[styles.reminderRow, i > 0 && styles.rowBorder]}>
                  <Bell size={16} color={Colors.primary} strokeWidth={2} />
                  <View style={styles.reminderBody}>
                    <Text style={styles.reminderName}>{rm.vaccineName}</Text>
                    <Text style={styles.reminderMeta}>{fmtDate(rm.remindAt)} - {rm.channel.toUpperCase()}</Text>
                  </View>
                  <StatusBadge label={rm.enabled ? 'On' : 'Off'} tone={rm.enabled ? 'success' : 'neutral'} />
                </View>
              ))}
            </SectionCard>
          )}
        </ScrollView>
      )}

      {/* U.12 — vaccination reminder setup sheet */}
      <Modal visible={!!target} transparent animationType="slide" onRequestClose={() => setTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => setTarget(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Set reminder</Text>
            <Pressable onPress={() => setTarget(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {target && (
            <>
              <Text style={styles.sheetBody}>{target.vaccineName} - due {fmtDate(target.dueDate)}</Text>
              <SelectField
                label="Channel"
                value={VACCINATION_REMINDER_CHANNEL_OPTIONS.find((o) => o.value === channel)?.label}
                options={VACCINATION_REMINDER_CHANNEL_OPTIONS.map((o) => o.label)}
                onChange={(label) => setChannel(VACCINATION_REMINDER_CHANNEL_OPTIONS.find((o) => o.label === label)?.value ?? 'push')}
                searchable={false}
              />
              <PrimaryButton label="Set reminder" onPress={saveReminder} loading={setReminder.isPending} style={styles.btn} />
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:         { marginBottom: Spacing.md },
  rowBorder:    { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  reminderRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  reminderBody: { flex: 1, gap: 2 },
  reminderName: { ...Typography.labelMd, color: Colors.onSurface },
  reminderMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40 },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  sheetBody:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  btn:          { marginTop: Spacing.sm },
});
