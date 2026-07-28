import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, ToggleRow } from '@/features/doctor/components';
import { useScheduleSettings, useSetVacation } from '@/features/doctor/hooks';

export default function VacationScreen() {
  const { data: settings, isLoading, isError, refetch } = useScheduleSettings();
  const setVacation = useSetVacation();

  const [active, setActive] = useState(false);
  const [startDate, setStartDate] = useState<string | undefined>();
  const [endDate, setEndDate] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings && !loaded) {
      const v = settings.vacation;
      if (v) { setActive(v.active); setStartDate(v.startDate); setEndDate(v.endDate); setNote(v.note ?? ''); }
      setLoaded(true);
    }
  }, [settings, loaded]);

  const canSave = !active || (!!startDate && !!endDate);

  const handleSave = async () => {
    if (!startDate || !endDate) {
      // turning vacation off without dates still needs valid dates for the input
      await setVacation.mutateAsync({ startDate: startDate ?? new Date().toISOString().slice(0, 10), endDate: endDate ?? new Date().toISOString().slice(0, 10), note: note || undefined, active: false });
      return;
    }
    await setVacation.mutateAsync({ startDate, endDate, note: note || undefined, active });
  };

  if (isLoading && !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Vacation mode" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Vacation mode" />
        <StateView variant="error" message="We could not load your schedule." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Vacation mode" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionCard title="Unavailable period" style={styles.card}>
            <Text style={styles.hint}>Turn on vacation mode to stop new bookings during a period. Patients see your note.</Text>
            <ToggleRow label="Vacation mode" description={active ? 'You are unavailable for this period.' : 'You are available as scheduled.'} value={active} onValueChange={setActive} />
          </SectionCard>

          {active && (
            <SectionCard title="Dates" style={styles.card}>
              <DatePickerField label="Start date" value={startDate} onChange={setStartDate} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 2} />
              <DatePickerField label="End date" value={endDate} onChange={setEndDate} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 2} />
              <TextInputField label="Note to patients (optional)" placeholder="e.g. Back on the 15th" value={note} onChangeText={setNote} />
            </SectionCard>
          )}

          {setVacation.isSuccess && (
            <View style={styles.savedRow}>
              <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.savedText}>Vacation settings saved.</Text>
            </View>
          )}

          <PrimaryButton label="Save" onPress={handleSave} loading={setVacation.isPending} disabled={!canSave} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  flex:      { flex: 1 },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:      { marginBottom: Spacing.md },
  hint:      { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  savedRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgTeal, marginBottom: Spacing.md },
  savedText: { ...Typography.labelMd, color: Colors.teal },
  btn:       { marginTop: Spacing.sm },
});
