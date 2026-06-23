import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Share2, Info, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SummaryRow from '@/features/fx/components/SummaryRow';
import { useVirtualAccounts } from '@/features/fx/hooks/useFx';
import { CURRENCIES } from '@/features/fx/constants/fx.constants';

export default function VirtualAccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useVirtualAccounts();
  const account = data?.find((a) => a.id === id);

  if (isLoading) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Account details" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (!account) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Account details" /><StateView kind="error" title="Account not found" /></SafeAreaView>;
  }

  const meta = CURRENCIES[account.currency];
  const d = account.details;
  const isIban = account.type === 'iban';

  const shareDetails = async () => {
    const lines = isIban
      ? [`Account name: ${d.accountName}`, `IBAN: ${d.iban}`, `BIC/SWIFT: ${d.bic}`, `Rails: ${(d.rails ?? []).join(', ')}`]
      : [`Account name: ${d.accountName}`, `Bank: ${d.bankName}`, `Account number: ${d.accountNumber}`];
    try { await Share.share({ message: `My ${account.currency} collection account\n\n${lines.join('\n')}` }); } catch { /* dismissed */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`${account.currency} ${isIban ? 'IBAN' : 'account'}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.flag}>{meta.flag}</Text>
          <Text style={styles.heroTitle}>{meta.name}</Text>
          <View style={styles.activePill}>
            <CheckCircle2 size={13} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.activeText}>Active</Text>
          </View>
        </View>

        <View style={styles.card}>
          <SummaryRow label="Account name" value={d.accountName} copyable />
          {isIban ? (
            <>
              <View style={styles.divider} />
              <SummaryRow label="IBAN" value={d.iban ?? '—'} copyable />
              <SummaryRow label="BIC / SWIFT" value={d.bic ?? '—'} copyable />
              <SummaryRow label="Rails" value={(d.rails ?? []).join(' · ')} />
            </>
          ) : (
            <>
              <View style={styles.divider} />
              <SummaryRow label="Bank" value={d.bankName ?? '—'} />
              <SummaryRow label="Account number" value={d.accountNumber ?? '—'} copyable />
            </>
          )}
        </View>

        <View style={styles.note}>
          <Info size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>
            {isIban
              ? `Share these details to receive ${account.currency} via ${(d.rails ?? []).join(' / ')}. Inbound funds credit your ${account.currency} wallet automatically once settled.`
              : `Share these details to receive ${account.currency} bank transfers. Funds credit your ${account.currency} wallet instantly on receipt.`}
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Share account details" onPress={shareDetails} fullWidth={false} style={styles.flexBtn} />
        <Pressable style={styles.shareIconBtn} onPress={shareDetails} accessibilityRole="button" accessibilityLabel="Share">
          <Share2 size={18} color={Colors.secondary} strokeWidth={2} />
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  flag: { fontSize: 44 },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  activeText: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '600' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  footer: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  flexBtn: { flex: 1 },
  shareIconBtn: { width: 56, height: 56, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
});
