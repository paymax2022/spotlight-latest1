import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Award } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CertificateScreen() {
  const p = useLocalSearchParams<{ reference: string; title: string; issuer: string; amount: string; units: string; lockIn: string }>();
  const amountKobo = Number(p.amount ?? 0);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.iconBox}><CircleCheck size={52} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
        <Text style={styles.title}>Investment confirmed</Text>
        <Text style={styles.sub}>Your subscription has been recorded. A cooling-off period applies before funds are committed.</Text>

        {/* Certificate card */}
        <View style={styles.cert}>
          <View style={styles.certHead}>
            <Award size={20} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.certTitle}>Investment certificate</Text>
          </View>
          <Row k="Offer" v={p.title ?? '—'} />
          <Row k="Issuer" v={p.issuer ?? '—'} />
          <Row k="Amount" v={formatNaira(amountKobo)} />
          <Row k="Holding" v={p.units ?? '—'} />
          <Row k="Reference" v={p.reference ?? '—'} mono />
          <Row k="Locked until" v={p.lockIn ? new Date(p.lockIn).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
        </View>

        <Text style={styles.note}>This certificate is also saved in your portfolio. Regulatory reports are filed automatically.</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="View portfolio" variant="secondary" onPress={() => router.replace('/crowdfunding/investment/portfolio')} />
        <PrimaryButton label="Done" onPress={() => router.dismissTo('/crowdfunding/investment')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (<View style={styles.row}><Text style={styles.k}>{k}</Text><Text style={[styles.v, mono && styles.mono]} numberOfLines={1}>{v}</Text></View>);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Spacing.lg, alignItems: 'center' },
  iconBox: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.md },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 },
  cert: { alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg, marginTop: Spacing.lg, gap: Spacing.sm },
  certHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.sm },
  certTitle: { ...Typography.titleMd, color: Colors.onSurface },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  k: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  v: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  mono: { fontVariant: ['tabular-nums'] },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.lg },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
