import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Sparkles, Gift, Crown, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { LoyaltyColors, POINTS_NOT_CASH_DISCLOSURE } from '@/features/loyalty/constants/loyalty.constants';

const SECTIONS = [
  { Icon: Sparkles, title: 'Earn points', body: 'Earn points automatically when you pay bills, buy event tickets, save, transfer money, and refer friends. Higher tiers earn at faster rates.' },
  { Icon: Gift, title: 'Redeem rewards', body: 'Spend points in the rewards catalog for airtime, bill credits, discounts, and partner perks. Points are deducted from your balance instantly.' },
  { Icon: Crown, title: 'Climb the tiers', body: 'Lifetime points move you from Bronze to Silver to Gold. Each tier unlocks better earn rates and exclusive perks.' },
];

export default function HowItWorks() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="How rewards work" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.card}>
            <View style={styles.iconBox}><s.Icon size={22} color={LoyaltyColors.brandText} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{s.title}</Text>
              <Text style={styles.cardBody}>{s.body}</Text>
            </View>
          </View>
        ))}

        {/* NL-4 — prominent non-cash disclosure */}
        <View style={styles.disclosure}>
          <ShieldAlert size={20} color={LoyaltyColors.brandText} />
          <Text style={styles.disclosureText}>{POINTS_NOT_CASH_DISCLOSURE}</Text>
        </View>

        <View style={{ height: Spacing.lg }} />
        <PrimaryButton label="Browse rewards catalog" onPress={() => router.push('/loyalty/catalog')} />
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: LoyaltyColors.brandBg, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardBody: { ...Typography.bodyMd, color: LoyaltyColors.muted, marginTop: 4, lineHeight: 22 },
  disclosure: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: LoyaltyColors.brandBg, borderRadius: Radius.lg, padding: Spacing.md },
  disclosureText: { ...Typography.bodySm, color: LoyaltyColors.brandText, flex: 1, lineHeight: 20 },
});
