import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Zap, SlidersHorizontal, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, ToggleRow, StateView } from '@/features/doctor/components';
import { useAvailability, useUpdateAvailability } from '@/features/doctor/hooks';
import { WEEKDAYS, CONSULT_DURATION_OPTIONS, BUFFER_OPTIONS } from '@/features/doctor/constants';
import type { AvailabilitySchedule, Weekday } from '@/types/doctor';

export default function AvailabilityScreen() {
  const { data: remote, isLoading, isError, refetch } = useAvailability();
  const update = useUpdateAvailability();
  const [schedule, setSchedule] = useState<AvailabilitySchedule | null>(null);

  useEffect(() => {
    if (remote && !schedule) setSchedule(remote);
  }, [remote, schedule]);

  const toggleDay = (day: Weekday) => {
    setSchedule((s) => (s ? { ...s, workingDays: s.workingDays.map((d) => (d.day === day ? { ...d, enabled: !d.enabled } : d)) } : s));
  };

  const handleSave = async () => {
    if (!schedule) return;
    try {
      await update.mutateAsync({ schedule });
      Alert.alert('Saved', 'Your availability has been updated.');
      goBack('/');
    } catch {
      Alert.alert('Save failed', 'Please try again.');
    }
  };

  if (isLoading && !schedule) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Availability" />
        <StateView variant="loading" label="Loading your schedule" />
      </SafeAreaView>
    );
  }

  if (isError || !schedule) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Availability" />
        <StateView variant="error" message="We could not load your schedule." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Availability" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SectionCard title="Working days" style={styles.card}>
          {WEEKDAYS.map((wd) => {
            const day = schedule.workingDays.find((d) => d.day === wd.day);
            const enabled = day?.enabled ?? false;
            return (
              <View key={wd.day} style={styles.dayRow}>
                <ToggleRow label={wd.label} description={enabled && day ? `${day.startTime} – ${day.endTime}` : 'Closed'} value={enabled} onValueChange={() => toggleDay(wd.day)} />
              </View>
            );
          })}
        </SectionCard>

        <SectionCard title="Consultation slots" style={styles.card}>
          <SelectField
            label="Slot duration"
            value={`${schedule.consultDurationMins} mins`}
            options={CONSULT_DURATION_OPTIONS.map((m) => `${m} mins`)}
            onChange={(v) => setSchedule((s) => (s ? { ...s, consultDurationMins: parseInt(v, 10) } : s))}
            searchable={false}
          />
          <SelectField
            label="Buffer between consults"
            value={`${schedule.bufferMins} mins`}
            options={BUFFER_OPTIONS.map((m) => `${m} mins`)}
            onChange={(v) => setSchedule((s) => (s ? { ...s, bufferMins: parseInt(v, 10) } : s))}
            searchable={false}
          />
        </SectionCard>

        <SectionCard style={styles.card}>
          <ToggleRow
            icon={Zap}
            iconColor={Colors.secondary}
            bgColor={Colors.iconBgBlue}
            label="Accept instant consults"
            description="Allow on-demand consultations when you are online."
            value={schedule.acceptsInstant}
            onValueChange={(v) => setSchedule((s) => (s ? { ...s, acceptsInstant: v } : s))}
          />
        </SectionCard>

        <PrimaryButton label="Save availability" onPress={handleSave} loading={update.isPending} style={styles.btn} />

        <Pressable style={styles.settingsLink} onPress={() => router.push('/(doctor)/schedule/settings')} accessibilityRole="button" accessibilityLabel="More schedule settings">
          <View style={styles.settingsIcon}>
            <SlidersHorizontal size={18} color={Colors.secondary} strokeWidth={2} />
          </View>
          <Text style={styles.settingsLabel}>Blocked dates, vacation, reminders & more</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:    { marginBottom: Spacing.md },
  dayRow:  { marginBottom: Spacing.xs },
  btn:     { marginTop: Spacing.sm },
  settingsLink:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  settingsIcon:  { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue },
  settingsLabel: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
});
