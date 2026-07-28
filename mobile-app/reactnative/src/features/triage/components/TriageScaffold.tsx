import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import DisclaimerBar from './DisclaimerBar';
import EmergencyFab from './EmergencyFab';
import LanguageToggle from './LanguageToggle';
import type { Language } from '../types';

/**
 * Shared triage screen shell that bakes in the SC-8 safety furniture so EVERY
 * screen carries it identically:
 *   • DisclaimerBar (medical disclaimer + "not a diagnosis", SC-1/SC-8)
 *   • EmergencyFab (persistent one-tap emergency shortcut, SC-8)
 * Plus the language toggle in the header. The full-screen Emergency view opts
 * out of the FAB (it IS the emergency screen) via `hideEmergencyFab`.
 */
export default function TriageScaffold({
  title,
  subtitle,
  lang,
  onChangeLang,
  sessionId,
  children,
  hideEmergencyFab,
  hideDisclaimer,
  onBack,
}: {
  title?: string;
  subtitle?: string;
  lang: Language;
  onChangeLang: (l: Language) => void;
  sessionId?: string;
  children: React.ReactNode;
  hideEmergencyFab?: boolean;
  hideDisclaimer?: boolean;
  onBack?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        rightSlot={<LanguageToggle value={lang} onChange={onChangeLang} />}
      />
      {!hideDisclaimer ? <DisclaimerBar lang={lang} /> : null}
      <View style={styles.body}>{children}</View>
      {!hideEmergencyFab ? <EmergencyFab lang={lang} sessionId={sessionId} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, marginTop: Spacing.sm },
});
