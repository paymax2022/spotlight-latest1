import React from 'react';
import { View, Text, ScrollView, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileBadge, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { usePolicy, useCertificate } from '@/features/insurance/hooks';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

/** Certificate viewer (signed-url placeholder; PRD §15.1 / §18 doc security). */
export default function CertificateViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const policy = usePolicy(id ?? '');
  const cert = useCertificate(id ?? '');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Certificate" subtitle={policy.data?.productName} />

      {policy.isLoading || cert.isLoading ? (
        <StateView kind="loading" message="Preparing your certificate…" />
      ) : policy.isError || !policy.data ? (
        <StateView kind="error" title="Couldn't load certificate" actionLabel="Retry" onAction={() => { policy.refetch(); cert.refetch(); }} />
      ) : !policy.data.certificateRef ? (
        <StateView kind="empty" title="No certificate yet" message="Your certificate is generated once your policy is active." icon="FileBadge" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Document placeholder card (PDF preview area) */}
          <View style={styles.doc}>
            <View style={styles.docIcon}><FileBadge size={36} color={InsuranceColors.brand} strokeWidth={1.8} /></View>
            <Text style={styles.docTitle}>Policy Certificate</Text>
            <Text style={styles.docRef}>{policy.data.certificateRef}</Text>
            <View style={styles.secureRow}>
              <Lock size={13} color={InsuranceColors.muted} />
              <Text style={styles.secureText}>Delivered via secure signed URL</Text>
            </View>
          </View>

          <UnderwriterBadge disclosure={policy.data.disclosure} />

          <View style={styles.card}>
            <PremiumRow label="Policy holder" value="You" />
            <PremiumRow label="Cover" amountKobo={policy.data.sumInsuredKobo} />
            <PremiumRow label="Effective" value={new Date(policy.data.effectiveAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })} />
            <PremiumRow label="Expires" value={new Date(policy.data.expiresAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })} />
          </View>
        </ScrollView>
      )}

      {policy.data?.certificateRef && cert.data?.url ? (
        <View style={styles.footer}>
          <PrimaryButton label="Open document" onPress={() => Linking.openURL(cert.data!.url).catch(() => {})} />
          <PrimaryButton label="Download" variant="secondary" onPress={() => Linking.openURL(cert.data!.url).catch(() => {})} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  doc: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.xs },
  docIcon: { width: 72, height: 72, borderRadius: Radius.lg, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  docTitle: { ...Typography.titleMd, color: Colors.onSurface },
  docRef: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.xs },
  secureText: { ...Typography.labelSm, color: InsuranceColors.muted },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
