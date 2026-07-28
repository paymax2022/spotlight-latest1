import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, CalendarX2, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, ToggleRow } from '@/features/doctor/components';
import { useBlockedDates, useBlockDate } from '@/features/doctor/hooks';

export default function BlockedDatesScreen() {
  const { data: blocked = [], isLoading, isError, refetch } = useBlockedDates();
  const block = useBlockDate();

  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const reset = () => { setDate(undefined); setReason(''); setAllDay(true); setStartTime(''); setEndTime(''); };
  const close = () => { setAdding(false); reset(); };

  const handleSave = async () => {
    if (!date) { Alert.alert('Select a date', 'Choose the date to block.'); return; }
    try {
      await block.mutateAsync({ date, reason: reason || undefined, allDay, startTime: allDay ? undefined : startTime, endTime: allDay ? undefined : endTime });
      close();
    } catch {
      Alert.alert('Failed', 'Could not block the date. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Blocked dates" />

      {isLoading && blocked.length === 0 ? (
        <StateView variant="loading" label="Loading blocked dates" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your blocked dates." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {blocked.length === 0 ? (
            <StateView variant="empty" icon={CalendarX2} title="No blocked dates" message="Block dates you are unavailable so patients can't book them." />
          ) : (
            <SectionCard title="Unavailable dates" style={styles.card}>
              {blocked.map((b, i) => (
                <View key={b.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <View style={styles.rowIcon}>
                    <CalendarX2 size={18} color={Colors.error} strokeWidth={2} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowDate}>{new Date(`${b.date}T00:00:00`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'long' })}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {b.allDay ? 'All day' : `${b.startTime} – ${b.endTime}`}{b.reason ? ` · ${b.reason}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </SectionCard>
          )}

          <Pressable style={styles.addBtn} onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="Block a date">
            <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
            <Text style={styles.addText}>Block a date</Text>
          </Pressable>
        </ScrollView>
      )}

      <Modal visible={adding} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Block a date</Text>
            <Pressable onPress={close} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <DatePickerField label="Date" value={date} onChange={setDate} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 2} />
          <TextInputField label="Reason (optional)" placeholder="e.g. Conference" value={reason} onChangeText={setReason} />
          <ToggleRow label="Block the whole day" value={allDay} onValueChange={setAllDay} />
          {!allDay && (
            <View style={styles.timeRow}>
              <View style={styles.half}>
                <TextInputField label="Start" placeholder="13:00" value={startTime} onChangeText={setStartTime} />
              </View>
              <View style={styles.half}>
                <TextInputField label="End" placeholder="16:00" value={endTime} onChangeText={setEndTime} />
              </View>
            </View>
          )}
          <PrimaryButton label="Block date" onPress={handleSave} loading={block.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card:        { marginBottom: Spacing.md },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  rowIcon:     { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.errorContainer },
  rowBody:     { flex: 1, gap: 2 },
  rowDate:     { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  timeRow:     { flexDirection: 'row', gap: Spacing.sm },
  half:        { flex: 1 },
  btn:         { marginTop: Spacing.sm },
});
