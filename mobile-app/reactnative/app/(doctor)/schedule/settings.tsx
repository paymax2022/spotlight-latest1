import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Siren } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, ToggleRow } from '@/features/doctor/components';
import { useScheduleSettings, useToggleEmergency } from '@/features/doctor/hooks';
import { TIMEZONE_OPTIONS } from '@/features/doctor/constants';

export default function ScheduleSettingsScreen() {
  const { data: settings, isLoading, isError, refetch } = useScheduleSettings();
  const toggleEmergency = useToggleEmergency();

  if (isLoading && !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Schedule settings" />
        <StateView variant="loading" label="Loading settings" />
      </SafeAreaView>
    );
  }

  if (isError || !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Schedule settings" />
        <StateView variant="error" message="We could not load your schedule settings." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const tzLabel = TIMEZONE_OPTIONS.find((t) => t.value === settings.timezone)?.label ?? settings.timezone;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Schedule settings" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* E5/E8 — emergency toggle (persisted) + appointment-mode nav row */}
        <SectionCard title="Availability mode" style={styles.card}>
          <ToggleRow
            icon={Siren}
            iconColor={Colors.error}
            bgColor={Colors.errorContainer}
            label="Emergency availability"
            description="Surface me for urgent / emergency cases."
            value={settings.emergencyAvailable}
            onValueChange={(enabled) => toggleEmergency.mutate({ enabled })}
            disabled={toggleEmergency.isPending}
          />
        </SectionCard>
        <View style={styles.menu}>
          <ProfileMenuItem
            icon="Zap"
            iconColor={Colors.secondary}
            bgColor={Colors.iconBgBlue}
            label={settings.appointmentOnly ? 'Appointment-only mode' : 'Instant consults enabled'}
            onPress={() => router.push('/(doctor)/availability')}
          />
        </View>

        <Text style={styles.groupTitle}>Working hours</Text>
        <View style={styles.menu}>
          <ProfileMenuItem icon="CalendarClock" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Working days & hours" onPress={() => router.push('/(doctor)/availability')} />
          <View style={styles.menuDivider} />
          <ProfileMenuItem icon="Repeat" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Recurring availability" onPress={() => router.push('/(doctor)/schedule/recurring')} />
        </View>

        <Text style={styles.groupTitle}>Time off</Text>
        <View style={styles.menu}>
          <ProfileMenuItem icon="CalendarX2" iconColor={Colors.error} bgColor={Colors.errorContainer} label="Blocked dates" onPress={() => router.push('/(doctor)/schedule/blocked-dates')} />
          <View style={styles.menuDivider} />
          <ProfileMenuItem icon="Palmtree" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label={settings.vacation?.active ? 'Vacation mode (on)' : 'Vacation mode'} onPress={() => router.push('/(doctor)/schedule/vacation')} />
        </View>

        <Text style={styles.groupTitle}>Preferences</Text>
        <View style={styles.menu}>
          <ProfileMenuItem icon="BellRing" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Appointment reminders" onPress={() => router.push('/(doctor)/schedule/reminders')} />
          <View style={styles.menuDivider} />
          <ProfileMenuItem icon="Globe" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label={`Timezone · ${tzLabel}`} onPress={() => router.push('/(doctor)/schedule/timezone')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:        { marginBottom: Spacing.md },
  divider:     { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.xs },
  groupTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  menu:        { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  menuDivider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.containerMargin },
});
