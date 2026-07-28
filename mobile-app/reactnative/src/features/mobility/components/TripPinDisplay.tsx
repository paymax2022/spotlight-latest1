import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  pin: string;
  hint?: string;
}

/** Big rider-facing trip PIN. Rider reads this to the driver who verifies it. */
export default function TripPinDisplay({ pin, hint = 'Share this PIN with your driver to start the trip' }: Props) {
  const digits = pin.split('');
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <ShieldCheck size={16} color={Colors.primary} strokeWidth={2.2} />
        <Text style={styles.label}>Your trip PIN</Text>
      </View>
      <View style={styles.pinRow}>
        {digits.map((d, i) => (
          <View key={i} style={styles.pinBox}>
            <Text style={styles.pinDigit}>{d}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onPrimaryFixed },
  pinRow: { flexDirection: 'row', gap: Spacing.sm },
  pinBox: { width: 54, height: 64, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  pinDigit: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
  hint: { ...Typography.labelSm, color: Colors.onPrimaryFixedVariant, marginTop: Spacing.md, textAlign: 'center' },
});
