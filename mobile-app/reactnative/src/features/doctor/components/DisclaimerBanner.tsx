import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  text: string;          // EMERGENCY_DISCLAIMER copy (mandatory on every emergency screen)
}

// New component: the mandatory, always-prominent DEMO disclaimer banner for
// every Section R emergency screen. AlertCard is a tappable affordance with a
// CTA/count and 2-line body clamp; the disclaimer must be non-interactive and
// fully visible, so a dedicated static banner is justified.
export default function DisclaimerBanner({ text }: Props) {
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLabel={text}>
      <ShieldAlert size={18} color={Colors.error} strokeWidth={2} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer, borderWidth: 1, borderColor: Colors.error },
  text:   { ...Typography.labelSm, color: Colors.error, flex: 1, fontWeight: '600' },
});
