import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheck, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import TxStatusBadge from '@/features/fx/components/TxStatusBadge';
import { parseToMinor, formatMoney } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

interface Row { name: string; account: string; amountMinor: number; valid: boolean }

export default function BulkPayoutScreen() {
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [raw, setRaw] = useState('');
  const [phase, setPhase] = useState<'input' | 'review' | 'submitting' | 'done'>('input');

  const rows: Row[] = useMemo(() => {
    return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [name, account, amount] = line.split(',').map((s) => s.trim());
      const amt = parseToMinor(amount ?? '', currency);
      return { name: name ?? '', account: account ?? '', amountMinor: amt, valid: !!name && !!account && account.length >= 6 && amt > 0 };
    });
  }, [raw, currency]);

  const valid = rows.filter((r) => r.valid);
  const invalid = rows.length - valid.length;
  const totalMinor = valid.reduce((s, r) => s + r.amountMinor, 0);

  const submit = () => {
    setPhase('submitting');
    setTimeout(() => setPhase('done'), 1300);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bulk payout" subtitle={phase === 'done' ? 'Submitted' : `${valid.length} recipient${valid.length === 1 ? '' : 's'}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {phase === 'done' ? (
          <View style={styles.doneWrap}>
            <View style={styles.doneIcon}><CircleCheck size={48} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
            <Text style={styles.doneTitle}>Bulk payout queued</Text>
            <Text style={styles.doneSub}>{valid.length} payouts totaling {formatMoney(totalMinor, currency)} are processing. Track them in Transactions.</Text>
            <View style={styles.statusCard}>
              {valid.map((r, i) => (
                <View key={i} style={styles.statusRow}>
                  <Text style={styles.rName} numberOfLines={1}>{r.name}</Text>
                  <TxStatusBadge status="queued" size="sm" />
                </View>
              ))}
            </View>
          </View>
        ) : (
          <>
            <View style={styles.currencyRow}>
              <Text style={styles.label}>Payout currency</Text>
              <CurrencyChip currency={currency} onPress={() => setCurrency(currency === 'USD' ? 'NGN' : 'USD')} />
            </View>

            <Text style={styles.label}>Recipients</Text>
            <Text style={styles.hint}>One per line: name, account number, amount</Text>
            <TextInput
              style={styles.textarea}
              value={raw}
              onChangeText={setRaw}
              placeholder={"John Snow, 237670000000, 100\nAmara Okafor, 0123456789, 250"}
              placeholderTextColor={Colors.outline}
              multiline
              textAlignVertical="top"
              autoCapitalize="words"
              accessibilityLabel="Bulk recipients"
            />

            {rows.length > 0 ? (
              <View style={styles.preview}>
                <View style={styles.previewHead}>
                  <Text style={styles.previewTitle}>Preview</Text>
                  <Text style={styles.total}>{formatMoney(totalMinor, currency)}</Text>
                </View>
                {rows.map((r, i) => (
                  <View key={i} style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={[styles.rName, !r.valid && styles.invalid]} numberOfLines={1}>{r.name || '—'}</Text>
                      <Text style={styles.rAcct} numberOfLines={1}>{r.account || 'missing account'}</Text>
                    </View>
                    {r.valid
                      ? <Text style={styles.rAmt}>{formatMoney(r.amountMinor, currency)}</Text>
                      : <TriangleAlert size={16} color={Colors.error} strokeWidth={2} />}
                  </View>
                ))}
                {invalid > 0 ? <Text style={styles.invalidNote}>{invalid} row{invalid === 1 ? '' : 's'} will be skipped (incomplete or invalid).</Text> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {phase === 'done' ? (
          <PrimaryButton label="View transactions" onPress={() => router.replace('/fx/transactions')} />
        ) : (
          <PrimaryButton label={`Submit ${valid.length} payout${valid.length === 1 ? '' : 's'}`} onPress={submit} loading={phase === 'submitting'} disabled={valid.length === 0} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  flex: { flex: 1 },
  currencyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  textarea: { minHeight: 140, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface },
  preview: { marginTop: Spacing.lg, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  previewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  previewTitle: { ...Typography.labelLg, color: Colors.onSurface },
  total: { ...Typography.titleMd, color: Colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  rName: { ...Typography.labelLg, color: Colors.onSurface },
  invalid: { color: Colors.error },
  rAcct: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  rAmt: { ...Typography.labelLg, color: Colors.onSurface },
  invalidNote: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm },
  doneWrap: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.xl },
  doneIcon: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  statusCard: { alignSelf: 'stretch', marginTop: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
