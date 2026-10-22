import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import {
  SYMPTOM_DISCLAIMER_COPY,
  SYMPTOM_PHARMACIST_LINK_COPY,
} from '../api/symptomSearch.api';

/**
 * Persistent, NON-dismissable info line for every symptom-search screen
 * (PRD Journey A step 4): the options shown are general advice, not a diagnosis,
 * with a link through to the pharmacist question screen. Tapping routes into
 * `/health/pharmacy/pharmacist-consult`, which states plainly whether a live
 * pharmacist channel is connected. Never render a close affordance.
 */
export default function SymptomDisclaimerBar() {
  return (
    <Pressable
      onPress={() => router.push('/health/pharmacy/pharmacist-consult')}
      accessibilityRole="button"
      accessibilityLabel="Ask a pharmacist about these options"
      style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
    >
      <Info size={14} color={Colors.secondary} strokeWidth={2} />
      <View style={styles.textWrap}>
        <Text style={styles.text}>
          {SYMPTOM_DISCLAIMER_COPY} <Text style={styles.link}>{SYMPTOM_PHARMACIST_LINK_COPY}</Text>
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgBlue,
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.sm + 2,
  },
  pressed: { opacity: 0.85 },
  textWrap: { flex: 1 },
  text: { ...Typography.caption, color: Colors.onSurface, lineHeight: 16 },
  link: { color: Colors.secondary, fontWeight: '700' as const },
});
