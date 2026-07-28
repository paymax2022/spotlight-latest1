import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, Vibrate } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, ToggleRow, StateView } from '@/features/doctor/components';
import { useAppPreferences, useUpdateAppPreferences } from '@/features/doctor/hooks';
import { APP_LANGUAGE_OPTIONS, THEME_OPTIONS } from '@/features/doctor/constants';
import type { AppLanguage, AppTheme, AppPreferences } from '@/types/doctor.batch7';

// ── Section AC — App preferences: language & theme (AC.12 / AC.13) ─────────────
// NEW screen: language + theme selectors and motion/haptics toggles share one
// AppPreferences and one useUpdateAppPreferences mutation. Reuses SelectField /
// ToggleRow.

export default function AppPreferencesScreen() {
  const { data: prefs, isLoading, isError, refetch } = useAppPreferences();
  const update = useUpdateAppPreferences();

  const patch = (preferences: Partial<AppPreferences>) => {
    update.mutate({ preferences }, { onError: () => Alert.alert('Failed', 'Could not save your preference. Please try again.') });
  };

  const langLabel = (v?: AppLanguage) => APP_LANGUAGE_OPTIONS.find((o) => o.value === v)?.label;
  const themeLabel = (v?: AppTheme) => THEME_OPTIONS.find((o) => o.value === v)?.label;
  const langFromLabel = (l: string): AppLanguage => APP_LANGUAGE_OPTIONS.find((o) => o.label === l)?.value ?? 'en';
  const themeFromLabel = (l: string): AppTheme => THEME_OPTIONS.find((o) => o.label === l)?.value ?? 'system';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Language & Theme" />
      {isLoading && !prefs ? (
        <StateView variant="loading" label="Loading preferences" />
      ) : isError || !prefs ? (
        <StateView variant="error" message="We could not load your preferences." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <SectionCard style={styles.card}>
            <SelectField label="Language" value={langLabel(prefs.language)} options={APP_LANGUAGE_OPTIONS.map((o) => o.label)} onChange={(l) => patch({ language: langFromLabel(l) })} searchable={false} />
            <SelectField label="Theme" value={themeLabel(prefs.theme)} options={THEME_OPTIONS.map((o) => o.label)} onChange={(l) => patch({ theme: themeFromLabel(l) })} searchable={false} />
          </SectionCard>

          <Text style={styles.groupTitle}>Accessibility</Text>
          <View style={styles.toggleGroup}>
            <ToggleRow icon={Sparkles} iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Reduce motion" value={prefs.reduceMotion} onValueChange={(v) => patch({ reduceMotion: v })} />
            <ToggleRow icon={Vibrate} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Haptics" value={prefs.hapticsEnabled} onValueChange={(v) => patch({ hapticsEnabled: v })} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  card:        { marginBottom: Spacing.md },
  groupTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  toggleGroup: { gap: Spacing.sm },
});
