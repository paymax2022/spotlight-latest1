import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView } from '@/features/doctor/components';
import { useScheduleSettings, useSetTimezone } from '@/features/doctor/hooks';
import { TIMEZONE_OPTIONS } from '@/features/doctor/constants';

export default function TimezoneScreen() {
  const { data: settings, isLoading, isError, refetch } = useScheduleSettings();
  const save = useSetTimezone();
  const [tz, setTz] = useState<string | null>(null);

  useEffect(() => {
    if (settings && tz === null) setTz(settings.timezone);
  }, [settings, tz]);

  const handleSave = async () => {
    if (!tz) return;
    await save.mutateAsync({ timezone: tz });
  };

  if (isLoading && !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Timezone" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !settings || tz === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Timezone" />
        <StateView variant="error" message="We could not load your timezone." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Timezone" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SectionCard title="Your timezone" style={styles.card}>
          <Text style={styles.hint}>Appointment times are shown and scheduled in this timezone.</Text>
          {TIMEZONE_OPTIONS.map((opt, i) => {
            const on = tz === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setTz(opt.value)}
                style={[styles.row, i > 0 && styles.rowBorder]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={opt.label}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{opt.label}</Text>
                  <Text style={styles.rowOffset}>UTC {opt.offset}</Text>
                </View>
                {on && <Check size={18} color={Colors.primary} strokeWidth={3} />}
              </Pressable>
            );
          })}
        </SectionCard>

        {save.isSuccess && (
          <View style={styles.savedRow}>
            <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.savedText}>Timezone saved.</Text>
          </View>
        )}

        <PrimaryButton label="Save" onPress={handleSave} loading={save.isPending} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:      { marginBottom: Spacing.md },
  hint:      { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  rowBody:   { flex: 1, gap: 2 },
  rowLabel:  { ...Typography.labelMd, color: Colors.onSurface },
  rowOffset: { ...Typography.caption, color: Colors.onSurfaceVariant },
  savedRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgTeal, marginBottom: Spacing.md },
  savedText: { ...Typography.labelMd, color: Colors.teal },
  btn:       { marginTop: Spacing.sm },
});
