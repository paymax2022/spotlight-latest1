import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, ClinicRow, ChipMultiSelect } from '@/features/doctor/components';
import { useClinicPortfolio, useSetActiveClinic, useUpdateClinicSchedule } from '@/features/doctor/hooks';
import { CLINIC_ROLE_LABELS } from '@/features/doctor/constants';
import type { ClinicMembership, ClinicSchedule } from '@/types/doctor.phase3';

const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_OPTIONS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

export default function ClinicsScreen() {
  const { data: portfolio, isLoading, isError, refetch } = useClinicPortfolio();
  const setActive = useSetActiveClinic();
  const updateSchedule = useUpdateClinicSchedule();

  const [editing, setEditing] = useState<ClinicMembership | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');

  const openEdit = (m: ClinicMembership) => {
    setEditing(m);
    setDays(m.schedule.days);
    setStartTime(m.schedule.startTime);
    setEndTime(m.schedule.endTime);
  };
  const closeEdit = () => setEditing(null);

  const handleSetActive = async (clinicId: string) => {
    try {
      await setActive.mutateAsync({ clinicId });
    } catch {
      Alert.alert('Failed', 'Could not switch the active clinic. Please try again.');
    }
  };

  const handleSaveSchedule = async () => {
    if (!editing) return;
    if (days.length === 0) {
      Alert.alert('Select days', 'Choose at least one working day.');
      return;
    }
    const schedule: ClinicSchedule = { days, startTime, endTime };
    try {
      await updateSchedule.mutateAsync({ clinicId: editing.id, schedule });
      Alert.alert('Schedule updated', `Your schedule at ${editing.name} has been saved.`);
      closeEdit();
    } catch {
      Alert.alert('Failed', 'Could not save the schedule. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="My Clinics" />

      {isLoading && !portfolio ? (
        <StateView variant="loading" label="Loading clinics" />
      ) : isError || !portfolio ? (
        <StateView variant="error" message="We could not load your clinics." onRetry={() => refetch()} />
      ) : portfolio.memberships.length === 0 ? (
        <StateView variant="empty" title="No clinics yet" message="Your clinic memberships will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.intro}>The active clinic determines which practice future consults are attributed to.</Text>
          {portfolio.memberships.map((m) => (
            <ClinicRow
              key={m.id}
              name={m.name}
              roleLabel={CLINIC_ROLE_LABELS[m.role]}
              location={[m.city, m.state].filter(Boolean).join(', ')}
              scheduleText={`${m.schedule.days.join(', ')} - ${m.schedule.startTime}-${m.schedule.endTime}`}
              feeSharePct={m.feeShareePct}
              patientsSeen={m.patientsSeen}
              active={m.id === portfolio.activeClinicId}
              busy={setActive.isPending}
              onSetActive={() => handleSetActive(m.id)}
              onEditSchedule={() => openEdit(m)}
            />
          ))}
        </ScrollView>
      )}

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={closeEdit}>
        <Pressable style={styles.backdrop} onPress={closeEdit} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{editing?.name}</Text>
            <Pressable onPress={closeEdit} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close schedule editor">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <ChipMultiSelect label="Working days" options={DAY_OPTIONS} selected={days} onChange={setDays} />
          <View style={styles.timeRow}>
            <View style={styles.half}>
              <SelectField label="Start" value={startTime} options={TIME_OPTIONS} onChange={setStartTime} searchable={false} />
            </View>
            <View style={styles.half}>
              <SelectField label="End" value={endTime} options={TIME_OPTIONS} onChange={setEndTime} searchable={false} />
            </View>
          </View>
          <PrimaryButton label="Save schedule" onPress={handleSaveSchedule} loading={updateSchedule.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:       { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  timeRow:     { flexDirection: 'row', gap: Spacing.sm },
  half:        { flex: 1 },
  btn:         { marginTop: Spacing.sm },
});
