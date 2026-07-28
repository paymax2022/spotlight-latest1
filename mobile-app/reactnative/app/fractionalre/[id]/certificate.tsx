import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCertificate } from '@/features/fractionalre/hooks';
import { useInvestDraft } from '@/features/fractionalre/store/investDraftStore';
import CertificateView from '@/features/fractionalre/components/CertificateView';

export default function CertificateScreen() {
  const { investmentId } = useLocalSearchParams<{ investmentId: string }>();
  const cert = useCertificate(investmentId);
  const reset = useInvestDraft((s) => s.reset);

  const done = (path: string) => { reset(); router.replace(path as never); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Investment confirmed" showBack={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.successHead}>
          <View style={styles.icon}><CheckCircle2 size={40} color={Colors.teal} strokeWidth={2} /></View>
          <Text style={styles.title}>You're now an investor</Text>
          <Text style={styles.sub}>Your units are allocated. Your certificate is below and saved to your documents vault.</Text>
        </View>

        {cert.isLoading ? (
          <StateView kind="loading" message="Generating certificate…" />
        ) : cert.data ? (
          <CertificateView certificate={cert.data} />
        ) : (
          <StateView kind="error" title="Certificate unavailable" message="It will appear in your documents shortly." />
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="View portfolio" onPress={() => done('/fractionalre/portfolio')} />
        <PrimaryButton label="Explore more" variant="secondary" onPress={() => done('/fractionalre/market')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  successHead: { alignItems: 'center', gap: Spacing.sm },
  icon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
});
