import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Repeat, Plus, CheckCircle2, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, EditableListCard, ChipMultiSelect } from '@/features/doctor/components';
import { useScheduleSettings, useSaveRecurringRule, checkOverbooking } from '@/features/doctor/hooks';
import { RECURRENCE_OPTIONS, RECURRENCE_LABELS, WEEKDAYS } from '@/features/doctor/constants';
import type { RecurrenceFrequency, WorkingDay } from '@/types/doctor.batch1';

const TIME_OPTIONS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export default function RecurringScreen() {
  const { data: settings, isLoading, isError, refetch } = useScheduleSettings();
  const save = useSaveRecurringRule();

  const [adding, setAdding] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('weekly');
  const [dayLabels, setDayLabels] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [startsOn, setStartsOn] = useState<string | undefined>();

  const reset = () => { setFrequency('weekly'); setDayLabels([]); setStartTime('09:00'); setEndTime('17:00'); setStartsOn(undefined); };
  const close = () => { setAdding(false); reset(); };

  const labelToDay = (label: string): WorkingDay['day'] => (WEEKDAYS.find((w) => w.label === label)?.day ?? 'mon');

  // E14 — overbooking check: does the chosen recurring window create more slots
  // than a standard working day's capacity? Pure helper, evaluated inline.
  const slotMins = settings ? Math.max(1, settings.schedule.consultDurationMins + settings.schedule.bufferMins) : 30;
  const slotsIn = (start: string, end: string) => Math.max(0, Math.floor((toMins(end) - toMins(start)) / slotMins));
  const baseDay = settings?.schedule.workingDays.find((d) => d.enabled);
  const capacity = baseDay ? slotsIn(baseDay.startTime, baseDay.endTime) : slotsIn('09:00', '17:00');
  const requested = slotsIn(startTime, endTime);
  const overbooking = checkOverbooking(startsOn ?? new Date().toISOString().slice(0, 10), capacity, 0, requested);

  const handleSave = async () => {
    if (!startsOn || dayLabels.length === 0) return;
    const days = dayLabels.map(labelToDay);
    await save.mutateAsync({ rule: { frequency, days, startTime, endTime, startsOn, active: true } });
    close();
  };

  if (isLoading && !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Recurring availability" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Recurring availability" />
        <StateView variant="error" message="We could not load your rules." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const rules = settings.recurringRules;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Recurring availability" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {rules.length === 0 ? (
          <StateView variant="empty" icon={Repeat} title="No recurring rules" message="Set a pattern that repeats so you don't re-enter hours each week." />
        ) : (
          <SectionCard title="Active patterns" style={styles.card}>
            {rules.map((r) => (
              <EditableListCard
                key={r.id}
                title={`${RECURRENCE_LABELS[r.frequency]} · ${r.startTime}–${r.endTime}`}
                subtitle={r.days.map((d) => WEEKDAYS.find((w) => w.day === d)?.label ?? d).join(', ')}
                meta={`From ${new Date(`${r.startsOn}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                badge={r.active ? 'Active' : undefined}
              />
            ))}
          </SectionCard>
        )}

        {save.isSuccess && (
          <View style={styles.savedRow}>
            <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.savedText}>Recurring rule saved.</Text>
          </View>
        )}

        <Pressable style={styles.addBtn} onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="Add recurring rule">
          <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
          <Text style={styles.addText}>Add a pattern</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={adding} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New pattern</Text>
              <Pressable onPress={close} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            </View>
            <SelectField label="Repeats" value={RECURRENCE_LABELS[frequency]} options={RECURRENCE_OPTIONS.map((o) => o.label)} onChange={(label) => setFrequency(RECURRENCE_OPTIONS.find((o) => o.label === label)?.value ?? 'weekly')} searchable={false} />
            <ChipMultiSelect label="Days" options={WEEKDAYS.map((w) => w.label)} selected={dayLabels} onChange={setDayLabels} />
            <View style={styles.timeRow}>
              <View style={styles.half}><SelectField label="Start" value={startTime} options={TIME_OPTIONS} onChange={setStartTime} searchable={false} /></View>
              <View style={styles.half}><SelectField label="End" value={endTime} options={TIME_OPTIONS} onChange={setEndTime} searchable={false} /></View>
            </View>
            <DatePickerField label="Starts on" value={startsOn} onChange={setStartsOn} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 2} />
            {requested > 0 && !overbooking.safe && (
              <View style={styles.warnRow}>
                <AlertTriangle size={18} color={Colors.error} strokeWidth={2} />
                <Text style={styles.warnText}>{overbooking.message}</Text>
              </View>
            )}
            <PrimaryButton label="Save pattern" onPress={handleSave} loading={save.isPending} disabled={!startsOn || dayLabels.length === 0} style={styles.btn} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card:        { marginBottom: Spacing.md },
  savedRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgTeal, marginBottom: Spacing.md },
  savedText:   { ...Typography.labelMd, color: Colors.teal },
  warnRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer, marginTop: Spacing.xs },
  warnText:    { ...Typography.labelSm, color: Colors.error, flex: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  timeRow:     { flexDirection: 'row', gap: Spacing.sm },
  half:        { flex: 1 },
  btn:         { marginTop: Spacing.sm },
});
