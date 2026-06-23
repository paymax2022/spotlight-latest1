import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePreferences, useUpdatePreferences } from '@/features/association/hooks/useSettings';
import { LANGUAGE_OPTIONS } from '@/features/association/types/settings.types';

export default function LanguageSettings() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const current = prefs.data?.language;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Language" />
      {prefs.isLoading || !prefs.data ? (
        <StateView kind="loading" message="Loading…" />
      ) : (
        <View style={styles.body}>
          <View style={[styles.card, shadow1]}>
            {LANGUAGE_OPTIONS.map((lang, i) => {
              const active = current === lang;
              return (
                <Pressable
                  key={lang}
                  style={[styles.row, i > 0 && styles.divider]}
                  onPress={() => update.mutate({ ...prefs.data!, language: lang })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={lang}
                >
                  <Text style={[styles.label, active && styles.labelActive]}>{lang}</Text>
                  {active ? <Check size={18} color={Colors.primary} strokeWidth={2.4} /> : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.note}>More languages are added over time. Some content may remain in English.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  label: { ...Typography.bodyLg, color: Colors.onSurface },
  labelActive: { color: Colors.primary, fontWeight: '600' as const },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
