import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Sun, Moon, Smartphone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePreferences, useUpdatePreferences } from '@/features/association/hooks/useSettings';
import type { ThemePref } from '@/features/association/types/settings.types';

const OPTIONS: { value: ThemePref; label: string; help: string; icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }> }[] = [
  { value: 'LIGHT', label: 'Light', help: 'Always use the light theme.', icon: Sun },
  { value: 'DARK', label: 'Dark', help: 'Always use the dark theme.', icon: Moon },
  { value: 'SYSTEM', label: 'System', help: 'Match your device setting.', icon: Smartphone },
];

export default function ThemeSettings() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const current = prefs.data?.theme;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Theme" />
      {prefs.isLoading || !prefs.data ? (
        <StateView kind="loading" message="Loading…" />
      ) : (
        <View style={styles.body}>
          <View style={[styles.card, shadow1]}>
            {OPTIONS.map((o, i) => {
              const active = current === o.value;
              const Icon = o.icon;
              return (
                <Pressable
                  key={o.value}
                  style={[styles.row, i > 0 && styles.divider]}
                  onPress={() => update.mutate({ ...prefs.data!, theme: o.value })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={o.label}
                >
                  <View style={styles.iconBox}><Icon size={18} color={Colors.primary} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
                    <Text style={styles.help}>{o.help}</Text>
                  </View>
                  {active ? <Check size={18} color={Colors.primary} strokeWidth={2.4} /> : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.note}>Dark theme rolls out per screen; some areas may stay light during the preview.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  labelActive: { color: Colors.primary },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
