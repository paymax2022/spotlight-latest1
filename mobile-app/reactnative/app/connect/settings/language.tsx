import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useLanguage, useSetLanguage } from '@/features/connect/hooks/useConnect';
import { LANGUAGES } from '@/features/connect/api/connect.api';

// ST-11 — Language settings. English, Pidgin, Hausa, Yoruba, Igbo.
export default function Language() {
  const { data: current, isLoading, error, refetch } = useLanguage();
  const set = useSetLanguage();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Language" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.card}>
            {LANGUAGES.map((l, i, arr) => {
              const active = current === l.code;
              return (
                <Pressable
                  key={l.code}
                  style={[styles.row, i < arr.length - 1 && styles.divider]}
                  onPress={() => set.mutate(l.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={styles.label}>{l.label}</Text>
                  {active ? <Check size={18} color={Colors.primary} strokeWidth={2.5} /> : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, paddingTop: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  label: { ...Typography.labelLg, color: Colors.onSurface },
});
