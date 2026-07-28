import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import {
  SYMPTOM_DISCLAIMER_COPY,
  SYMPTOM_PHARMACIST_LINK_COPY,
} from '../api/symptomSearch.api';

/**
 * Persistent, NON-dismissable info line for every symptom-search screen
 * (PRD Journey A step 4): "These are general options for your symptoms, not a
 * diagnosis. Speak to a pharmacist free — tap here." Tapping routes into the
 * existing free pharmacist chat. Never render a close affordance.
 */
export default function SymptomDisclaimerBar() {
  return (
    <Pressable
      onPress={() => router.push('/health/pharmacy/pharmacist-consult')}
      accessibilityRole="button"
      accessibilityLabel="Speak to a pharmacist for free"
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
