import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BadgeCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';

const ITEMS = [
  { label: 'Email verified', done: true },
  { label: 'Phone verified', done: true },
  { label: 'Identity (KYC)', done: true },
  { label: 'Business (KYB)', done: false },
];

export default function VerificationSettings() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.badge}>
          <BadgeCheck size={32} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.badgeTitle}>ID Verified</Text>
          <Text style={styles.badgeSub}>You can create campaigns and withdraw funds.</Text>
        </View>
        <View style={styles.card}>
          {ITEMS.map((it, i, arr) => (
            <View key={it.label} style={[styles.row, i < arr.length - 1 && styles.rowBorder]}>
              <Text style={styles.label}>{it.label}</Text>
              {it.done ? (
                <View style={styles.doneChip}><BadgeCheck size={13} color={Colors.tertiaryContainer} strokeWidth={2.2} /><Text style={styles.doneText}>Verified</Text></View>
              ) : (
                <View style={styles.pendChip}><Clock size={13} color={'#B65A00'} strokeWidth={2} /><Text style={styles.pendText}>Not started</Text></View>
              )}
            </View>
          ))}
        </View>
        <View style={styles.cta}><PrimaryButton label="Complete business verification (KYB)" variant="secondary" onPress={() => {}} /></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
  badge: { alignItems: 'center', gap: 4, paddingVertical: Spacing.lg },
  badgeTitle: { ...Typography.titleLg, color: Colors.onSurface },
  badgeSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  doneText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '600' as const },
  pendChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgOrange, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  pendText: { ...Typography.caption, color: '#B65A00', fontWeight: '600' as const },
  cta: { marginTop: Spacing.lg },
});
