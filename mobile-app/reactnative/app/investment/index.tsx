import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { LineChart, Bitcoin, GraduationCap, Sparkles, Trophy, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';

type Tab = 'stock' | 'crypto';

const TABS: { key: Tab; label: string }[] = [
  { key: 'stock', label: 'Stocks' },
  { key: 'crypto', label: 'Crypto' },
];

/**
 * Investment landing — one screen, a tab at the top pointing to each module.
 * Stocks → the Paymax Invest module (/invest); Crypto → the crypto module
 * (/crypto). Shared quick links below for Learn, AI and Wealth.
 */
export default function InvestmentLanding() {
  const [tab, setTab] = useState<Tab>('stock');
  const isStock = tab === 'stock';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Investment" subtitle="Own the companies & assets shaping your future" />

      {/* Top tabs */}
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, active && styles.tabActive]}>
              {t.key === 'stock'
                ? <LineChart size={16} color={active ? Colors.onPrimary : Colors.onSurfaceVariant} />
                : <Bitcoin size={16} color={active ? Colors.onPrimary : Colors.onSurfaceVariant} />}
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <LinearGradient
            colors={(isStock ? Colors.gradientCard : ['#3A2A00', '#7A5200']) as readonly [string, string, ...string[]]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroIcon}>
              {isStock ? <LineChart size={26} color={Colors.white} /> : <Bitcoin size={26} color={Colors.white} />}
            </View>
            <Text style={styles.heroTitle}>{isStock ? 'Nigerian Stocks & ETFs' : 'Crypto Assets'}</Text>
            <Text style={styles.heroBody}>
              {isStock
                ? 'Buy and sell NGX-listed stocks and ETFs, track your portfolio, dividends and settlement — education-first and compliance-gated.'
                : 'Buy, sell and hold crypto with a regulated, education-first experience. Fund from your wallet, track holdings and learn as you go.'}
            </Text>
            <PrimaryButton
              label={isStock ? 'Open Stock trading' : 'Open Crypto'}
              onPress={() => router.push(isStock ? '/invest' : '/crypto')}
              style={{ marginTop: Spacing.md, backgroundColor: Colors.white }}
            />
          </LinearGradient>
        </View>

        <Text style={styles.sectionTitle}>More in Investment</Text>
        <View style={[styles.card, shadow1]}>
          <Row icon={<GraduationCap size={20} color={Colors.teal} />} label="Learn Center" sub="Stock & crypto basics, quizzes, glossary" onPress={() => router.push('/learn')} />
          <View style={styles.divider} />
          <Row icon={<Sparkles size={20} color={Colors.secondary} />} label="Invest AI" sub="Ask about terms, fees, risks (not advice)" onPress={() => router.push('/invest-ai')} />
          <View style={styles.divider} />
          <Row icon={<Trophy size={20} color={Colors.gold} />} label="Spotlight Wealth" sub="Creator wealth academy & challenges" onPress={() => router.push('/spotlight-wealth')} />
        </View>

        <Text style={styles.disclaimer}>
          Investing carries risk. Prices can rise or fall and you may get back less than you invest.
          This is educational information, not financial advice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, sub, onPress }: { icon: React.ReactNode; label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabs: {
    flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 4,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.md,
  },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tabTextActive: { color: Colors.onPrimary },
  section: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.cardPadding },
  heroIcon: {
    width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  heroTitle: { ...Typography.headlineMd, color: Colors.white },
  heroBody: { ...Typography.bodyMd, color: 'rgba(255,255,255,0.85)', marginTop: Spacing.xs },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  rowIcon: {
    width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  disclaimer: {
    ...Typography.labelSm, color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, fontStyle: 'italic',
  },
});
