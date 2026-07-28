import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FileText, Clock, BadgeCheck, CircleX, CircleAlert, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { usePrescription } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

export default function RxStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rx, isLoading, isError, refetch } = usePrescription(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Prescription status" />

      {isLoading ? (
        <StateView kind="loading" message="Loading prescription…" />
      ) : isError || !rx ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Status hero */}
          <View style={[styles.hero, shadow1]}>
            <View style={styles.heroIconWrap}>
              {rx.status === 'verifying' ? (
                <Clock size={34} color={Colors.onWarning} strokeWidth={1.8} />
              ) : rx.status === 'verified' ? (
                <BadgeCheck size={34} color={Colors.teal} strokeWidth={1.8} />
              ) : rx.status === 'clarification' ? (
                <CircleAlert size={34} color={Colors.onWarning} strokeWidth={1.8} />
              ) : (
                <CircleX size={34} color={Colors.error} strokeWidth={1.8} />
              )}
            </View>
            <PharmacyStatusPill rx={rx.status} />
            <Text style={styles.heroTitle}>
              {rx.status === 'verifying'
                ? 'Verifying your prescription'
                : rx.status === 'verified'
                ? 'Prescription verified'
                : rx.status === 'clarification'
                ? 'More information needed'
                : 'Prescription rejected'}
            </Text>
            <Text style={styles.heroSub}>
              {rx.status === 'verifying'
                ? 'A licensed pharmacist is reviewing it. This usually takes a few minutes.'
                : rx.status === 'verified'
                ? `Verified by ${rx.pharmacistName ?? 'a pharmacist'}${rx.pharmacyName ? ` · ${rx.pharmacyName}` : ''}.`
                : rx.pharmacistNote ?? 'Please review the pharmacist note and re-upload.'}
            </Text>
          </View>

          {/* Pharmacist note (rejection / clarification) */}
          {rx.pharmacistNote && rx.status !== 'verified' ? (
            <View style={styles.note}>
              <Text style={styles.noteLabel}>Pharmacist note</Text>
              <Text style={styles.noteBody}>{rx.pharmacistNote}</Text>
            </View>
          ) : null}

          {/* Document */}
          <View style={[styles.docCard, shadow1]}>
            <View style={[styles.docThumb, { backgroundColor: rx.docColor }]}>
              <FileText size={22} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.docTitle}>Uploaded prescription</Text>
              <Text style={styles.docSub}>
                {rx.patientName} · Uploaded {formatDate(rx.uploadedAt)}
              </Text>
            </View>
          </View>

          {/* Items (once verified) */}
          {rx.items.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Prescribed items</Text>
              {rx.items.map((it, i) => (
                <View key={i} style={[styles.itemRow, shadow1]}>
                  <View style={styles.itemBody}>
                    <Text style={styles.itemName}>{it.name}</Text>
                    <Text style={styles.itemSub}>
                      {it.dosage} · {it.quantity}
                    </Text>
                  </View>
                  {rx.status === 'verified' && it.productId ? (
                    <Pressable
                      style={styles.addBtn}
                      onPress={() => router.push({ pathname: '/health/pharmacy/product/[id]', params: { id: it.productId as string } })}
                    >
                      <Plus size={14} color={Colors.secondary} strokeWidth={2.4} />
                      <Text style={styles.addText}>Add</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      {rx && rx.status === 'verified' ? (
        <View style={styles.footer}>
          <PrimaryButton label="Order verified medicines" onPress={() => router.push('/health/pharmacy/cart')} />
        </View>
      ) : rx && (rx.status === 'rejected' || rx.status === 'clarification') ? (
        <View style={styles.footer}>
          <PrimaryButton label="Re-upload prescription" onPress={() => router.replace('/health/pharmacy/upload-rx')} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: 40 },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
  },
  heroIconWrap: {
    width: 72,
    height: 72,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  heroSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 19 },
  note: {
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  noteLabel: { ...Typography.labelSm, color: Colors.onWarning, textTransform: 'uppercase', letterSpacing: 0.4 },
  noteBody: { ...Typography.bodySm, color: Colors.onWarning, lineHeight: 19 },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  docThumb: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  heroBody: { flex: 1 },
  docTitle: { ...Typography.labelLg, color: Colors.onSurface },
  docSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  itemBody: { flex: 1 },
  itemName: { ...Typography.labelLg, color: Colors.onSurface },
  itemSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  addText: { ...Typography.labelMd, color: Colors.secondary },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
