import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Scale, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import { MASTER_RISK_DISCLOSURE } from '@/features/fractionalre/constants';

const LINKS = [
  { label: 'Terms of service', url: 'https://example.com/legal/terms' },
  { label: 'Privacy policy', url: 'https://example.com/legal/privacy' },
  { label: 'SEC investor notice', url: 'https://example.com/legal/sec-notice' },
  { label: 'Complaints & dispute resolution', url: 'https://example.com/legal/complaints' },
];

export default function LegalScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Legal & disclosures" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {LINKS.map((l) => (
          <Pressable key={l.label} style={styles.row} onPress={() => Linking.openURL(l.url).catch(() => {})}>
            <View style={styles.iconBox}><Scale size={18} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.rowLabel}>{l.label}</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        ))}

        <Text style={styles.discTitle}>Master risk disclosure</Text>
        <View style={styles.discBox}>
          {MASTER_RISK_DISCLOSURE.split('\n\n').map((p, i) => (
            <Text key={i} style={styles.disc}>{p}</Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  discTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  discBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  disc: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
});
