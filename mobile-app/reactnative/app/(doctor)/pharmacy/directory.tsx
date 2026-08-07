import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Store, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { formatKobo } from '@/api/doctor.batch3.api';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, PharmacyRow, StockBadge } from '@/features/doctor/components';
import {
  usePharmacies,
  usePreferredPharmacy,
  useDrugStock,
  useSelectPharmacy,
} from '@/features/doctor/hooks';
import type { Pharmacy } from '@/types/doctor.batch3';
import { alertAsync } from '@/lib/confirm';

// ── Section L — Pharmacy directory ────────────────────────────────────────────
// NEW screen: preferred + nearby verified pharmacies (PharmacyRow), per-drug
// stock availability (StockBadge) with a drug-unavailable alert (L8), and select
// (L6). Reachable from the send-to-pharmacy flow and the pharmacy list.

export default function PharmacyDirectoryScreen() {
  const { prescriptionId } = useLocalSearchParams<{ prescriptionId?: string }>();
  const { data: pharmacies = [], isLoading, isError, refetch } = usePharmacies();
  const { data: preferred } = usePreferredPharmacy();
  const select = useSelectPharmacy();

  const [selected, setSelected] = useState<Pharmacy | undefined>(preferred);
  const chosen = selected ?? preferred;

  const sorted = [...pharmacies].sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || a.distanceKm - b.distanceKm);

  const handleSelect = async () => {
    if (!chosen) {
      alertAsync({ title: 'Select a pharmacy', message: 'Choose a pharmacy to continue.' });
      return;
    }
    if (!prescriptionId) {
      await alertAsync({ title: 'Selected', message: `${chosen.name} selected.` });
      router.back();
      return;
    }
    try {
      await select.mutateAsync({ prescriptionId: String(prescriptionId), pharmacyId: chosen.id });
      await alertAsync({ title: 'Sent', message: `The prescription has been sent to ${chosen.name}.`, buttonLabel: 'View pharmacy' });
      router.replace('/(doctor)/pharmacy');
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not select the pharmacy. Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Choose Pharmacy" />

      {isLoading && pharmacies.length === 0 ? (
        <StateView variant="loading" label="Finding pharmacies" />
      ) : isError ? (
        <StateView variant="error" message="We could not load pharmacies." onRetry={() => refetch()} />
      ) : pharmacies.length === 0 ? (
        <StateView variant="empty" icon={Store} title="No pharmacies nearby" message="No verified pharmacies were found near the patient." />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {/* L4 — preferred pharmacy */}
            {!!preferred && (
              <>
                <Text style={styles.sectionTitle}>Preferred pharmacy</Text>
                <PharmacyRow pharmacy={preferred} selected={chosen?.id === preferred.id} onSelect={setSelected} />
                <Text style={[styles.sectionTitle, styles.sectionGap]}>Nearby verified pharmacies</Text>
              </>
            )}
            <View style={styles.list}>
              {sorted.filter((p) => !preferred || p.id !== preferred.id).map((p) => (
                <PharmacyRow key={p.id} pharmacy={p} selected={chosen?.id === p.id} onSelect={setSelected} />
              ))}
            </View>

            {/* L7 / L8 — drug stock availability + unavailable alert for the chosen pharmacy */}
            {!!chosen && <DrugStockPanel pharmacy={chosen} />}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label={prescriptionId ? 'Send to this pharmacy' : 'Select pharmacy'} onPress={handleSelect} loading={select.isPending} disabled={!chosen} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function DrugStockPanel({ pharmacy }: { pharmacy: Pharmacy }) {
  const { data: stock = [], isLoading } = useDrugStock(pharmacy.id);
  const outOfStock = stock.filter((s) => s.level === 'out_of_stock');

  return (
    <SectionCard title="Drug availability" style={styles.stockCard}>
      {/* L8 — drug-unavailable alert */}
      {outOfStock.length > 0 && (
        <View style={styles.alert}>
          <AlertTriangle size={16} color={Colors.error} strokeWidth={2.2} />
          <Text style={styles.alertText}>{outOfStock.map((s) => s.drugName).join(', ')} out of stock at {pharmacy.name}.</Text>
        </View>
      )}
      {isLoading && stock.length === 0 ? (
        <Text style={styles.stockMuted}>Checking stock…</Text>
      ) : stock.length === 0 ? (
        <Text style={styles.stockMuted}>No stock information for this pharmacy.</Text>
      ) : (
        stock.map((s, i) => (
          <View key={`${s.drugName}-${i}`} style={[styles.stockRow, i > 0 && styles.stockBorder]}>
            <View style={styles.stockBody}>
              <Text style={styles.stockName}>{s.drugName} {s.strength}</Text>
              {!!s.note && <Text style={styles.stockNote}>{s.note}</Text>}
              {typeof s.unitPriceKobo === 'number' && <Text style={styles.stockPrice}>{formatKobo(s.unitPriceKobo)} / unit</Text>}
            </View>
            <StockBadge level={s.level} />
          </View>
        ))
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  sectionGap:  { marginTop: Spacing.md },
  list:        { gap: Spacing.sm },
  stockCard:   { marginTop: Spacing.md },
  alert:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.errorContainer, marginBottom: Spacing.sm },
  alertText:   { flex: 1, ...Typography.labelSm, color: Colors.error },
  stockMuted:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stockRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  stockBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  stockBody:   { flex: 1, gap: 2 },
  stockName:   { ...Typography.labelLg, color: Colors.onSurface },
  stockNote:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  stockPrice:  { ...Typography.caption, color: Colors.onSurface },
  footer:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background },
});
