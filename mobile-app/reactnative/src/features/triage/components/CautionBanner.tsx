import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { t } from '../i18n';
import type { Language, Profile } from '../types';
import { PAEDIATRIC_AGE_YEARS } from '../constants';

function ageYears(dob: string): number {
  const d = new Date(dob);
  const diff = Date.now() - d.getTime();
  return diff / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * SC-9 — extra-caution copy for paediatric & maternal flows. Renders only when
 * the active profile is a child (or under the paediatric age) or pregnant.
 * Returns null otherwise.
 */
export default function CautionBanner({
  lang,
  profile,
}: {
  lang: Language;
  profile?: Profile | null;
}) {
  if (!profile) return null;
  const s = t(lang);
  const isChild = profile.kind === 'child' || ageYears(profile.dob) < PAEDIATRIC_AGE_YEARS;
  const isMaternal = profile.isPregnant === true;
  if (!isChild && !isMaternal) return null;

  const message = isMaternal ? s.maternalCaution : s.childCaution;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <ShieldAlert size={18} color={Colors.onWarning} strokeWidth={2} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
  },
  text: { ...Typography.bodySm, color: Colors.onWarning, flex: 1, lineHeight: 19 },
});
