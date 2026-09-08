import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getTopupStatus } from '@/features/payments';
import { HomeMenuButton } from '@/components/HomeMenu';

// Top-up status screen. Wallet funding is confirmed asynchronously by the
// Paystack webhook (which credits the ledger), so after the in-app SDK checkout
// closes we land here and poll GET /api/v1/wallet/topup/{reference} until the
// webhook marks it complete (or it fails / times out).

type TopupView = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

function toView(status: string, completed: boolean): TopupView {
  if (completed) return 'SUCCESSFUL';
  if (status.toLowerCase() === 'failed') return 'FAILED';
  return 'PENDING';
}

const VIEW_COLOR: Record<TopupView, string> = {
  SUCCESSFUL: '#16A34A',
  FAILED: Colors.error,
  PENDING: Colors.secondary,
};

function StatusIcon({ view, color }: { view: TopupView; color: string }) {
  if (view === 'SUCCESSFUL') return <CheckCircle2 size={34} color={color} strokeWidth={1.8} />;
  if (view === 'FAILED') return <XCircle size={34} color={color} strokeWidth={1.8} />;
  return <Clock size={34} color={color} strokeWidth={1.8} />;
}

function summary(view: TopupView): string {
  if (view === 'SUCCESSFUL') return 'Your wallet has been funded successfully.';
  if (view === 'FAILED') return 'This funding attempt did not go through. You were not charged, or any charge will be reversed.';
  return 'We are confirming your payment. This page refreshes automatically.';
}

export default function TopupStatusScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['wallet', 'topup', reference],
    queryFn: () => getTopupStatus(reference ?? ''),
    enabled: !!reference,
    // Poll while still pending; stop once completed or failed.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      return d.completed || d.status.toLowerCase() === 'failed' ? false : 3000;
    },
  });

  const view: TopupView | null = data ? toView(data.status, data.completed) : null;
  const color = view ? VIEW_COLOR[view] : Colors.outline;

  // When funding completes, refresh the wallet balance projections.
  React.useEffect(() => {
    if (view === 'SUCCESSFUL') {
      qc.invalidateQueries({ queryKey: ['wallet'] });
    }
  }, [view, qc]);

  const goWallet = () => router.replace('/wallet' as never);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={goWallet} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Wallet Funding</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => refetch()} style={styles.iconBtn}>
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : isError && !data ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load funding status.</Text>
          <PrimaryButton label="Retry" onPress={() => refetch()} style={{ marginTop: Spacing.lg, width: 160 }} fullWidth={false} />
        </View>
      ) : view ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={[styles.amountCard, shadow1]}>
            <View style={[styles.statusIcon, { backgroundColor: `${color}18` }]}>
              <StatusIcon view={view} color={color} />
            </View>
            <Text style={[styles.status, { color }]}>{view}</Text>
            {data && data.amountKobo > 0 && (
              <Text style={styles.amount}>
                ₦{(data.amountKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
              </Text>
            )}
            <Text style={styles.ref}>{data?.reference}</Text>
            <Text style={styles.statusSummary}>{summary(view)}</Text>
          </View>

          <View style={styles.actions}>
            {view === 'PENDING' && (
              <View style={styles.processingBox}>
                <ActivityIndicator size="small" color={Colors.secondary} />
                <Text style={styles.processingText}>Confirming your payment. This page refreshes automatically.</Text>
              </View>
            )}
            <PrimaryButton label="Done" onPress={goWallet} />
            {view === 'FAILED' && (
              <PrimaryButton
                label="Try Again"
                variant="secondary"
                onPress={() => router.replace('/wallet/add' as never)}
              />
            )}
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  topBar:      { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn:     { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle:    { ...Typography.titleLg, color: Colors.primary },
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  errorText:   { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  amountCard:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  statusIcon:  { width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  status:      { ...Typography.labelMd, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  amount:      { fontSize: 36, fontWeight: '800', color: Colors.onSurface, letterSpacing: 0 },
  ref:         { ...Typography.labelSm, color: Colors.outline },
  statusSummary:{ ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actions:     { gap: Spacing.sm, marginBottom: Spacing.lg },
  processingBox:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.md },
  processingText:{ ...Typography.labelSm, color: Colors.secondary, flex: 1 },
});
