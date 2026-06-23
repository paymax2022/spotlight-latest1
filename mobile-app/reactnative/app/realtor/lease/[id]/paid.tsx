import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useEscrow } from '@/features/realtor/hooks/useRealtorLease';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';

export default function LeasePaidScreen() {
  const { id, ref } = useLocalSearchParams<{ id: string; ref?: string }>();
  const escrow = useEscrow(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}>
          <CheckCircle2 size={44} color={Colors.tertiaryContainer} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>Payment successful</Text>
        <Text style={styles.subtitle}>Your tenancy is now active. Reference {ref ?? '—'}.</Text>

        {escrow.data ? (
          <View style={styles.escrowCard}>
            <ShieldCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
            <View style={styles.escrowBody}>
              <Text style={styles.escrowTitle}>{formatNaira(escrow.data.amount)} held in escrow</Text>
              <Text style={styles.escrowSub}>{escrow.data.releaseCondition}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Start move-in" onPress={() => router.replace(`/realtor/lease/${id}/move-in`)} />
        <PrimaryButton label="Back to marketplace" variant="secondary" onPress={() => router.replace('/realtor')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  escrowCard: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'center', alignSelf: 'stretch',
    backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md,
  },
  escrowBody: { flex: 1 },
  escrowTitle: { ...Typography.labelLg, color: Colors.tertiaryContainer },
  escrowSub: { ...Typography.bodySm, color: Colors.tertiaryContainer, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
