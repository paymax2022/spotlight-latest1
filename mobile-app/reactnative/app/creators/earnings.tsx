import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Banknote, HandCoins, FileText, Repeat, ShieldAlert, FolderOpen } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SectionHeader from '@/components/SectionHeader';
import { useEarnings } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira, NL5_DISCLOSURE } from '@/features/creators/constants/creators.constants';
import type { EarningEntry } from '@/features/creators/types';

const SOURCE_ICON = { tip: HandCoins, subscription: Repeat, content: FileText };

export default function Earnings() {
  const earnings = useEarnings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/creators')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Earnings</Text>
        <Pressable onPress={() => router.push('/creators/content/manage')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Manage content"><FolderOpen size={20} color={Colors.onSurface} /></Pressable>
      </View>

      {earnings.isLoading ? (
        <StateView kind="loading" message="Loading earnings…" />
      ) : earnings.isError || !earnings.data ? (
        <StateView kind="error" title="Couldn't load earnings" actionLabel="Retry" onAction={() => earnings.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.balanceCard}>
            <Text style={styles.balLabel}>Available to withdraw</Text>
            <Text style={styles.balValue}>{formatNaira(earnings.data.availableKobo)}</Text>
            <View style={styles.balMetaRow}>
              <Text style={styles.balMeta}>Pending {formatNaira(earnings.data.pendingKobo)}</Text>
              <Text style={styles.balMeta}>Lifetime {formatNaira(earnings.data.lifetimeKobo)}</Text>
            </View>
            {!earnings.data.payoutKycDone ? (
              <View style={styles.kycWarn}><ShieldAlert size={14} color={CreatorsColors.warnText} /><Text style={styles.kycWarnText}>Complete payout KYC to withdraw.</Text></View>
            ) : null}
          </View>

          <PrimaryButton label="Withdraw earnings" onPress={() => router.push('/creators/payout')} style={{ marginTop: Spacing.md }} />

          <View style={styles.disclosure}><Text style={styles.disclosureText}>{NL5_DISCLOSURE}</Text></View>

          <SectionHeader title="Recent earnings" style={styles.sectionHeader} />
          {earnings.data.recent.length === 0 ? (
            <StateView kind="empty" compact title="No earnings yet" message="Tips, subscriptions and content unlocks appear here." icon="Banknote" />
          ) : (
            <View style={styles.card}>
              {earnings.data.recent.map((e) => <EarningRow key={e.id} entry={e} />)}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function EarningRow({ entry }: { entry: EarningEntry }) {
  const Icon = SOURCE_ICON[entry.source] ?? Banknote;
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Icon size={18} color={CreatorsColors.brand} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel} numberOfLines={1}>{entry.label}</Text>
        <Text style={styles.rowDate}>{new Date(entry.atISO).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</Text>
      </View>
      <Text style={styles.rowAmount}>+{formatNaira(entry.amountKobo)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  balanceCard: { backgroundColor: CreatorsColors.brand, borderRadius: Radius.xl, padding: Spacing.lg, gap: 4 },
  balLabel: { ...Typography.labelMd, color: '#D3BBFF' },
  balValue: { ...Typography.displayLg, fontSize: 36, lineHeight: 42, color: '#FFFFFF' },
  balMetaRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: 4 },
  balMeta: { ...Typography.labelSm, color: '#EBDCFF' },
  kycWarn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm, backgroundColor: CreatorsColors.warnBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.md, alignSelf: 'flex-start' },
  kycWarnText: { ...Typography.labelSm, color: CreatorsColors.warnText },
  disclosure: { backgroundColor: CreatorsColors.warnBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  disclosureText: { ...Typography.labelSm, color: CreatorsColors.warnText },
  sectionHeader: { marginTop: Spacing.lg },
  card: { backgroundColor: CreatorsColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, ...shadow1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: CreatorsColors.border },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: CreatorsColors.brandBg },
  rowLabel: { ...Typography.labelLg, color: CreatorsColors.text },
  rowDate: { ...Typography.labelSm, color: CreatorsColors.muted, marginTop: 1 },
  rowAmount: { ...Typography.titleMd, color: CreatorsColors.ok },
});
