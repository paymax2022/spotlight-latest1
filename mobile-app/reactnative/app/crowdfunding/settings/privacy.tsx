import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';

const FIELDS = [
  { key: 'showName', label: 'Show my name on contributions', sub: 'Off = contribute anonymously by default' },
  { key: 'profilePublic', label: 'Public creator profile', sub: 'Let others see your campaigns' },
  { key: 'searchable', label: 'Appear in search', sub: 'Others can find you by name' },
  { key: 'analytics', label: 'Share usage analytics', sub: 'Helps us improve the app' },
];

export default function PrivacySettings() {
  const [state, setState] = useState<Record<string, boolean>>({ showName: true, profilePublic: true, searchable: false, analytics: true });
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Privacy" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {FIELDS.map((f, i, arr) => (
            <Pressable key={f.key} style={[styles.row, i < arr.length - 1 && styles.rowBorder]} onPress={() => setState((s) => ({ ...s, [f.key]: !s[f.key] }))} accessibilityRole="switch" accessibilityState={{ checked: state[f.key] }}>
              <View style={styles.rowBody}><Text style={styles.label}>{f.label}</Text><Text style={styles.sub}>{f.sub}</Text></View>
              <View style={[styles.switch, state[f.key] && styles.switchOn]}><View style={[styles.knob, state[f.key] && styles.knobOn]} /></View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowBody: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
});
