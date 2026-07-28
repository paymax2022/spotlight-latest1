import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Building2, QrCode, Package, Info } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useDropOff } from '@/features/health/lab/hooks';

const LAB_ID = 'lab_synlab';
const LAB_NAME = 'SynLab Diagnostics';

export default function DropOffScreen() {
  const { orderId, barcode } = useLocalSearchParams<{ orderId: string; barcode: string }>();
  const dropOff = useDropOff();

  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  const onConfirm = async () => {
    await dropOff.mutateAsync({
      orderId,
      labId: LAB_ID,
      barcode,
      note: note.trim() || undefined,
    });
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lab drop-off" subtitle={LAB_NAME} />
        <StateView
          kind="empty"
          icon="PackageCheck"
          title="Sample handed off"
          message={`Delivered to ${LAB_NAME}. The lab will accession this sample next.`}
          actionLabel="Back to assignments"
          onAction={() => router.replace('/health/lab/phlebotomist/assignments')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Lab drop-off" subtitle="Hand-off to lab" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sample</Text>
          <View style={styles.summaryRow}>
            <QrCode size={18} color={Colors.onSurfaceVariant} />
            <Text style={styles.summaryLabel}>Barcode</Text>
            <Text style={styles.summaryValue}>{barcode}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Package size={18} color={Colors.onSurfaceVariant} />
            <Text style={styles.summaryLabel}>Order</Text>
            <Text style={styles.summaryValue}>{orderId}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Destination</Text>
          <View style={styles.destRow}>
            <View style={styles.destIcon}>
              <Building2 size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.destName}>{LAB_NAME}</Text>
              <Text style={styles.destMeta}>Drop-off destination</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Handoff note (optional)</Text>
          <TextInputField
            value={note}
            onChangeText={setNote}
            placeholder="Any note for the receiving lab"
            multiline
          />
        </View>

        <View style={styles.note}>
          <Info size={18} color={Colors.primary} />
          <Text style={styles.noteText}>
            Confirming hand-off transfers custody to the lab for accessioning.
          </Text>
        </View>

        <PrimaryButton
          label="Confirm sample dropped"
          onPress={onConfirm}
          loading={dropOff.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...shadow1,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  summaryLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, width: 64 },
  summaryValue: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  destIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destName: { ...Typography.titleMd, color: Colors.onSurface },
  destMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  note: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.iconBgBlue,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
