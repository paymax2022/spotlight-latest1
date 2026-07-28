import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import OptionList from '@/features/crowdfunding/components/OptionList';

const LANGS = [
  { value: 'en-NG', label: 'English', sub: 'Nigeria' },
  { value: 'pcm', label: 'Nigerian Pidgin' },
  { value: 'ha', label: 'Hausa' },
  { value: 'yo', label: 'Yorùbá' },
  { value: 'ig', label: 'Igbo' },
  { value: 'fr', label: 'Français' },
];

export default function LanguageSettings() {
  const [lang, setLang] = useState('en-NG');
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Language" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <OptionList options={LANGS} value={lang} onChange={setLang} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
});
