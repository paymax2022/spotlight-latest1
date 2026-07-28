import React from 'react';
import { View, Text, ScrollView, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useSettings, useUpdateSettings } from '@/features/estatesettings/hooks';
import { TOGGLE_FIELDS } from '@/features/estatesettings/api';
import type { MemberSettings } from '@/features/estatesettings/api';

export default function EstateSettingsScreen() {
  const { data, isLoading, isError, refetch } = useSettings();
  const update = useUpdateSettings();

  if (isLoading) return <Wrap><StateView kind="loading" message="Loading settings…" /></Wrap>;
  if (isError || !data) return <Wrap><StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Wrap>;

  const toggle = (key: keyof MemberSettings, value: boolean) => update.mutate({ [key]: value } as Partial<MemberSettings>);

  const channels = TOGGLE_FIELDS.slice(0, 2);
  const categories = TOGGLE_FIELDS.slice(2);

  return (
    <Wrap>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>Channels</Text>
        <View style={styles.card}>
          {channels.map((f, i) => (
            <Row key={f.key} label={f.label} hint={f.hint} value={!!data[f.key]} onChange={(v) => toggle(f.key, v)} border={i > 0} />
          ))}
        </View>

        <Text style={styles.section}>Notify me about</Text>
        <View style={styles.card}>
          {categories.map((f, i) => {
            const masterOff = !data.pushEnabled && !data.emailEnabled;
            return <Row key={f.key} label={f.label} hint={f.hint} value={!!data[f.key]} disabled={masterOff} onChange={(v) => toggle(f.key, v)} border={i > 0} />;
          })}
        </View>
        <Text style={styles.footnote}>Turn off both Push and Email to pause all estate notifications.</Text>
      </ScrollView>
    </Wrap>
  );
}

function Row({ label, hint, value, onChange, border, disabled }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; border?: boolean; disabled?: boolean }) {
  return (
    <View style={[styles.row, border && styles.rowBorder, disabled && styles.rowDisabled]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: Colors.primary, false: Colors.surfaceContainerLow }} />
    </View>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Settings" subtitle="Notifications" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, ...shadow1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footnote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
