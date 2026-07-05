import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SocialColors, formatNaira } from '../constants/social.constants';

interface Props {
  remainingKobo: number;
  /** Optional blocking message when the amount exceeds the remaining limit (NL-10). */
  blockedMessage?: string | null;
}

/** Shows the user's remaining daily AML allowance + any limit warning. */
export default function AmlBanner({ remainingKobo, blockedMessage }: Props) {
  const blocked = !!blockedMessage;
  return (
    <View style={[styles.wrap, { backgroundColor: blocked ? SocialColors.dangerBg : SocialColors.surfaceAlt }]}>
      {blocked
        ? <TriangleAlert size={16} color={SocialColors.danger} strokeWidth={2} />
        : <ShieldCheck size={16} color={SocialColors.accent} strokeWidth={2} />}
      <Text style={[styles.text, blocked && { color: SocialColors.danger }]}>
        {blocked ? blockedMessage : `Remaining daily send limit: ${formatNaira(remainingKobo)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md },
  text: { ...Typography.bodySm, color: SocialColors.text, flex: 1 },
});
