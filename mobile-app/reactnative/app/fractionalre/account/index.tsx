import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  UserCog, FileText, Users, Gift, Scale, ShieldCheck, ChevronRight, BadgeCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import { useInvestorProfile } from '@/features/fractionalre/hooks';
import { formatNaira } from '@/features/fractionalre/utils';

const MENU = [
  { icon: UserCog, label: 'Investor profile', sub: 'Classification, limits & HNI upgrade', route: '/fractionalre/account/profile' },
  { icon: FileText, label: 'Documents vault', sub: 'Certificates, statements & disclosures', route: '/fractionalre/account/documents' },
  { icon: Users, label: 'Beneficiaries', sub: 'Who inherits your holdings', route: '/fractionalre/account/beneficiaries' },
  { icon: Gift, label: 'Referrals', sub: 'Invite friends, earn rewards', route: '/fractionalre/account/referrals' },
  { icon: ShieldCheck, label: 'Verification (KYC)', sub: 'Identity & suitability', route: '/kyc' },
  { icon: Scale, label: 'Legal & disclosures', sub: 'Terms, risk & SEC notices', route: '/fractionalre/account/legal' },
];

export default function AccountHub() {
  const profile = useInvestorProfile();
  const p = profile.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Account" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {p ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <BadgeCheck size={18} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.cardTitle}>{p.classification === 'hni' ? 'High-Net-Worth Investor' : p.classification === 'qualified' ? 'Qualified Investor' : 'Retail Investor'}</Text>
            </View>
            <Text style={styles.cardSub}>Remaining annual allowance</Text>
            <Text style={styles.allowance}>{formatNaira(p.remainingAllowanceKobo)}</Text>
            <Text style={styles.cardSub}>of {formatNaira(p.annualLimitKobo)} limit</Text>
          </View>
        ) : null}

        {MENU.map((m) => (
          <Pressable key={m.label} style={styles.row} onPress={() => router.push(m.route as never)}>
            <View style={styles.iconBox}><m.icon size={18} color={Colors.primary} strokeWidth={2} /></View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{m.label}</Text>
              <Text style={styles.rowSub}>{m.sub}</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  card: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 2, marginBottom: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  cardSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  allowance: { ...Typography.headlineMd, color: Colors.onPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
