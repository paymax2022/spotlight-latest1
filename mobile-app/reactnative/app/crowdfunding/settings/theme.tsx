import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import OptionList from '@/features/crowdfunding/components/OptionList';

const THEMES = [
  { value: 'light', label: 'Light', sub: 'Default' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Use device setting' },
];

export default function ThemeSettings() {
  const [theme, setTheme] = useState('light');
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Theme" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <OptionList options={THEMES} value={theme} onChange={setTheme} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
});
