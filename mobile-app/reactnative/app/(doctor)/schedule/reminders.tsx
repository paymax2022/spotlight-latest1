import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, CheckCircle2, Bell, Mail, MessageCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, ToggleRow } from '@/features/doctor/components';
import { useScheduleSettings, useSaveReminderSettings } from '@/features/doctor/hooks';
import { REMINDER_OFFSET_OPTIONS } from '@/features/doctor/constants';
import type { ReminderSettings } from '@/types/doctor.batch1';

export default function RemindersScreen() {
  const { data: settings, isLoading, isError, refetch } = useScheduleSettings();
  const save = useSaveReminderSettings();
  const [form, setForm] = useState<ReminderSettings | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(settings.reminders);
  }, [settings, form]);

  const set = (patch: Partial<ReminderSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const toggleOffset = (value: number) => {
    setForm((f) => {
      if (!f) return f;
      const has = f.offsetsMins.includes(value);
      return { ...f, offsetsMins: has ? f.offsetsMins.filter((o) => o !== value) : [...f.offsetsMins, value] };
    });
  };

  const handleSave = async () => {
    if (!form) return;
    await save.mutateAsync({ reminders: form });
  };

  if (isLoading && !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Reminders" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !settings || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Reminders" />
        <StateView variant="error" message="We could not load your reminders." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Reminders" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SectionCard title="Appointment reminders" style={styles.card}>
          <ToggleRow label="Remind me before appointments" value={form.enabled} onValueChange={(enabled) => set({ enabled })} />
        </SectionCard>

        {form.enabled && (
          <>
            <SectionCard title="When to remind me" style={styles.card}>
              <View style={styles.grid}>
                {REMINDER_OFFSET_OPTIONS.map((opt) => {
                  const on = form.offsetsMins.includes(opt.value);
                  return (
                    <Pressable key={opt.value} onPress={() => toggleOffset(opt.value)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={opt.label}>
                      {on && <Check size={14} color={Colors.primary} strokeWidth={3} />}
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </SectionCard>

            <SectionCard title="Channels" style={styles.card}>
              <ToggleRow icon={Bell} label="Push" value={form.channelPush} onValueChange={(channelPush) => set({ channelPush })} />
              <ToggleRow icon={Mail} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Email" value={form.channelEmail} onValueChange={(channelEmail) => set({ channelEmail })} />
              <ToggleRow icon={MessageCircle} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="SMS" value={form.channelSms} onValueChange={(channelSms) => set({ channelSms })} />
            </SectionCard>
          </>
        )}

        {save.isSuccess && (
          <View style={styles.savedRow}>
            <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.savedText}>Reminder settings saved.</Text>
          </View>
        )}

        <PrimaryButton label="Save" onPress={handleSave} loading={save.isPending} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:       { marginBottom: Spacing.md },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  chipOn:     { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipText:   { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn: { color: Colors.primary },
  savedRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgTeal, marginBottom: Spacing.md },
  savedText:  { ...Typography.labelMd, color: Colors.teal },
  btn:        { marginTop: Spacing.sm },
});
