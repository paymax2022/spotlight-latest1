import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePrivacy, useUpdatePrivacy } from '@/features/association/hooks/useProfile';
import type { PrivacySettings } from '@/features/association/types/profile.types';

const ROWS: { key: keyof PrivacySettings; label: string; help: string }[] = [
  { key: 'showInDirectory', label: 'Show me in the member directory', help: 'Other members can find your profile.' },
  { key: 'showPhone', label: 'Show my phone number', help: 'Visible on your public profile.' },
  { key: 'showEmail', label: 'Show my email', help: 'Visible on your public profile.' },
  { key: 'showProfession', label: 'Show my profession', help: 'Displayed in the directory and profile.' },
];

export default function PrivacySettingsScreen() {
  const privacy = usePrivacy();
  const update = useUpdatePrivacy();

  const value = privacy.data;

  const toggle = (key: keyof PrivacySettings) => {
    if (!value) return;
    update.mutate({ ...value, [key]: !value[key] });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Privacy" />
      {privacy.isLoading || !value ? (
        <StateView kind="loading" message="Loading settings…" />
      ) : (
        <View style={styles.body}>
          <Text style={styles.intro}>Control what other members can see. Admins always retain access for verification.</Text>
          <View style={[styles.card, shadow1]}>
            {ROWS.map((r, i) => (
              <View key={r.key} style={[styles.row, i > 0 && styles.rowDivider]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{r.label}</Text>
                  <Text style={styles.help}>{r.help}</Text>
                </View>
                <Switch
                  value={value[r.key]}
                  onValueChange={() => toggle(r.key)}
                  trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
                  thumbColor={Colors.white}
                  accessibilityLabel={r.label}
                />
              </View>
            ))}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
