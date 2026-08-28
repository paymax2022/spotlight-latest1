// ── Film Academy — pay tuition ───────────────────────────────────────────────
// A NATIVE screen. Tuition becomes payable only once the admin approves the
// application; approval is what creates the instalment plan, so if there is no
// plan there is nothing to pay and this screen says so rather than inventing a
// figure.
//
// Money note: academy amounts are NAIRA (these tables predate the kobo
// convention used across finance). Paystack takes kobo, hence the ×100 at the
// gateway boundary — and the server re-verifies both the reference AND the
// amount, so nothing computed here is trusted.

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleCheck, Clock, Lock, GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { usePaystackGateway, PAYSTACK_PUBLIC_KEY } from '@/features/payments';
import {
  getApplicationStatus,
  payInstalment,
  FILM_ACADEMY_STATUS_KEY,
} from '@/features/filmAcademy/api';
import { getErrorMessage } from '@/utils/errorMapper';

function formatNaira(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `₦${Number(n).toLocaleString('en-NG')}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FilmAcademyTuitionScreen() {
  const queryClient = useQueryClient();
  const gateway = usePaystackGateway();
  const payReady = Boolean(PAYSTACK_PUBLIC_KEY);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: FILM_ACADEMY_STATUS_KEY,
    queryFn: getApplicationStatus,
  });

  const application = data?.application ?? null;
  const plan = data?.plan ?? null;
  const payments = data?.payments ?? [];
  const approved = application?.status === 'approved';
  // Enrolment — not full settlement — is what opens the course. The server grants
  // it on the first settled instalment, so someone paying monthly starts now
  // rather than after the last payment.
  const enrolled = data?.enrolled ?? false;

  // Instalments are settled in order. Letting someone pay #3 while #1 is
  // outstanding would leave the plan in a state the reminder logic cannot read.
  const nextDue = payments.find((p) => p.status !== 'paid' && p.status !== 'waived') ?? null;

  const handlePay = () => {
    if (!plan || !nextDue || !application) return;
    setError(null);
    setNotice(null);

    if (!payReady) {
      setError('Card payment is unavailable right now. Please try again later.');
      return;
    }

    const email = application.email ?? '';
    if (!email) {
      setError('No email on your application — contact support to pay.');
      return;
    }

    setBusyId(nextDue.id);
    gateway.open({
      email,
      amountKobo: Math.round(Number(nextDue.amount_ngn) * 100),
      domain: 'academy_tuition',
      metadataFields: [
        { display_name: 'Purpose', variable_name: 'purpose', value: 'Film Academy tuition' },
        { display_name: 'Instalment', variable_name: 'installment_number', value: String(nextDue.installment_number) },
      ],
      onSuccess: (reference) => {
        void (async () => {
          try {
            await payInstalment({ planId: plan.id, paymentId: nextDue.id, reference });
            setNotice('Payment confirmed.');
            await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_STATUS_KEY });
          } catch (e) {
            // The money left the card but the server would not record it. Say so
            // plainly with the reference — telling them to "try again" here would
            // charge them twice.
            setError(
              `${getErrorMessage(e)} Your payment reference is ${reference} — quote it to support rather than paying again.`,
            );
          } finally {
            setBusyId(null);
          }
        })();
      },
      onCancel: () => { setBusyId(null); setError('Payment cancelled.'); },
      onError: (m) => { setBusyId(null); setError(m || 'Payment failed. Please try again.'); },
    });
  };

  const paidCount = payments.filter((p) => p.status === 'paid').length;
  const allPaid = payments.length > 0 && paidCount === payments.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Tuition</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading…</Text>
          </View>
        )}

        {!isLoading && !approved && (
          <View style={styles.state}>
            <Lock size={28} color={Colors.onSurfaceVariant} />
            <Text style={styles.stateText}>
              Tuition becomes payable once your application is approved. You have paid your
              application fee — nothing else is due yet.
            </Text>
            <Pressable onPress={() => router.replace('/film-academy/status')} style={styles.retry}>
              <Text style={styles.retryText}>View my application</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && approved && !plan && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              Your tuition plan is being prepared. Check back shortly.
            </Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Refresh</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && approved && !!plan && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardMeta}>Total tuition</Text>
              <Text style={styles.total}>
                {formatNaira(plan.discounted_amount_ngn ?? plan.total_amount_ngn)}
              </Text>
              <Text style={styles.cardMeta}>
                {paidCount} of {payments.length} instalment{payments.length === 1 ? '' : 's'} paid
              </Text>
              {/* The application fee is admin-configurable, so it is described
                  rather than quoted — a hardcoded figure here would go stale the
                  moment the admin changes it. */}
              <Text style={styles.refundNote}>
                Tuition is refundable under the programme refund policy. Your application
                fee is separate and non-refundable.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Instalments</Text>
              {payments.map((p) => {
                const isNext = nextDue?.id === p.id;
                return (
                  <View key={p.id} style={[styles.row, isNext && styles.rowNext]}>
                    {p.status === 'paid'
                      ? <CircleCheck size={18} color={Colors.teal} />
                      : <Clock size={18} color={Colors.onSurfaceVariant} />}
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>Instalment {p.installment_number}</Text>
                      <Text style={styles.rowMeta}>
                        {p.status === 'paid' ? `Paid ${formatDate(p.paid_at)}` : `Due ${formatDate(p.due_date)}`}
                      </Text>
                    </View>
                    <Text style={styles.rowAmount}>{formatNaira(p.amount_ngn)}</Text>
                  </View>
                );
              })}
            </View>

            {!!error && <Text style={styles.error}>{error}</Text>}
            {!!notice && <Text style={styles.notice}>{notice}</Text>}

            {allPaid ? (
              <View style={styles.doneBox}>
                <CircleCheck size={20} color={Colors.teal} />
                <Text style={styles.doneText}>Tuition fully paid. Your place is secured.</Text>
              </View>
            ) : (
              <Pressable
                onPress={handlePay}
                disabled={!nextDue || busyId !== null}
                style={[styles.payBtn, (!nextDue || busyId !== null) && styles.payBtnDisabled]}
              >
                {busyId ? (
                  <ActivityIndicator color={Colors.black} />
                ) : (
                  <Text style={styles.payBtnText}>
                    Pay {formatNaira(nextDue?.amount_ngn)}
                  </Text>
                )}
              </Pressable>
            )}

            {/* The way into the course, once the learner has actually earned a
                place. Gated on `enrolled` rather than on allPaid: paying the
                first instalment is what secures it, and gating on the flag also
                means a payment that settled but failed to enrol never offers a
                button that lands on a locked screen. */}
            {enrolled && (
              <Pressable
                onPress={() => router.push('/film-academy/learn' as never)}
                style={[styles.learnBtn, allPaid ? styles.learnBtnPrimary : styles.learnBtnSecondary]}
              >
                <GraduationCap size={18} color={allPaid ? Colors.black : Colors.gold} />
                <Text style={[styles.learnBtnText, { color: allPaid ? Colors.black : Colors.gold }]}>
                  {allPaid ? 'Go to my course' : 'Continue to my course'}
                </Text>
                <ChevronRight size={18} color={allPaid ? Colors.black : Colors.gold} />
              </Pressable>
            )}

            {allPaid && !enrolled && (
              // Paid but not enrolled should be impossible; saying so beats a
              // dead end, and it tells support exactly what to look for.
              <Text style={styles.cardMeta}>
                Your payment is recorded but your place is still being set up. Pull to
                refresh in a moment, or contact support if this persists.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      <gateway.Sheet />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  cardMeta:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  total:       { ...Typography.headlineMd, color: Colors.onSurface },
  refundNote:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },

  section:     { gap: Spacing.sm },
  sectionTitle:{ ...Typography.labelMd, color: Colors.onSurfaceVariant },

  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  rowNext:     { borderWidth: 1, borderColor: Colors.gold },
  rowBody:     { flex: 1, gap: 2 },
  rowLabel:    { ...Typography.labelLg, color: Colors.onSurface },
  rowMeta:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowAmount:   { ...Typography.titleMd, color: Colors.onSurface },

  error:       { ...Typography.bodySm, color: Colors.error },
  notice:      { ...Typography.bodySm, color: Colors.teal },

  payBtn:      { backgroundColor: Colors.gold, borderRadius: Radius.md, paddingVertical: Spacing.md,
                 alignItems: 'center', justifyContent: 'center' },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText:  { ...Typography.labelLg, color: Colors.black },

  learnBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                 gap: Spacing.sm, borderRadius: Radius.md, paddingVertical: Spacing.md },
  learnBtnPrimary:   { backgroundColor: Colors.gold },
  learnBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.gold },
  learnBtnText: { ...Typography.labelLg },

  doneBox:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 backgroundColor: Colors.iconBgGreen, borderRadius: Radius.lg, padding: Spacing.lg },
  doneText:    { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
