import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ShieldCheck, Check, Megaphone, Users, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { showToast } from '@/store/toastStore';
import { DisclosureCard } from '@/features/referral/components';
import { AMBASSADOR_DISCLOSURE } from '@/features/referral/ambassador/api';
import {
  useMyAmbassadorApplication,
  useApplyAsAmbassador,
} from '@/features/referral/ambassador/hooks';

// M-AMB-00 — Become an ambassador. The disclosure is mandatory: the programme
// pays commission on referrals, and the backend rejects an application whose
// disclosure was not accepted (400). The exact text shown here is what gets
// stored, so the record matches what the applicant actually read.

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  applied: {
    title: 'Application received',
    body: 'Our team is reviewing your application. You will be notified once a decision is made.',
  },
  approved: {
    title: 'You are an ambassador',
    body: 'Your application was approved. Your ambassador tools are available now.',
  },
  suspended: {
    title: 'Your ambassador status is suspended',
    body: 'Contact support if you believe this is a mistake.',
  },
  rejected: {
    title: 'Application not approved',
    body: 'You can apply again once you meet the programme requirements.',
  },
};

export default function AmbassadorApplyScreen() {
  const { data: application, isLoading, isError, refetch } = useMyAmbassadorApplication();
  const apply = useApplyAsAmbassador();
  const [accepted, setAccepted] = useState(false);

  const onSubmit = () => {
    apply.mutate(
      { tier: 'bronze', disclosureAccepted: true },
      {
        onSuccess: () =>
          showToast({
            variant: 'success',
            title: 'Application submitted',
            message: 'We will review it shortly.',
          }),
        onError: () =>
          showToast({
            variant: 'error',
            title: 'Could not submit your application',
            message: 'Please try again.',
          }),
      },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Become an ambassador" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Become an ambassador" />
        <StateView
          kind="error"
          title="Couldn't load"
          message="Please try again."
          actionLabel="Retry"
          onAction={refetch}
        />
      </SafeAreaView>
    );
  }

  // Already applied (or decided) — show where they stand instead of a form that
  // would silently overwrite the existing application.
  if (application) {
    const copy = STATUS_COPY[application.status] ?? STATUS_COPY.applied;
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScreenHeader title="Ambassador programme" />
        <StateView
          kind="empty"
          icon={application.status === 'approved' ? 'ShieldCheck' : 'Clock'}
          title={copy.title}
          message={copy.body}
          actionLabel={application.status === 'approved' ? 'Open ambassador zone' : 'Done'}
          onAction={() =>
            application.status === 'approved'
              ? router.replace('/referral/ambassador/dashboard')
              : goBack('/referral')
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Become an ambassador" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Megaphone size={24} color={Colors.tertiaryContainer} strokeWidth={2} />
          </View>
          <Text style={styles.bannerTitle}>Earn from what your audience actually does</Text>
          <Text style={styles.bannerBody}>
            Ambassadors earn commission when people they refer complete verified activity —
            never for signing people up.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>What you get</Text>
        <View style={styles.perks}>
          <Perk
            icon={<Users size={18} color={Colors.secondary} strokeWidth={2} />}
            title="Audience insights"
            body="See who you referred and how they are progressing."
          />
          <Perk
            icon={<Megaphone size={18} color={Colors.secondary} strokeWidth={2} />}
            title="Creative toolkit"
            body="Ready-made banners, captions and tracked links."
          />
          <Perk
            icon={<Clock size={18} color={Colors.secondary} strokeWidth={2} />}
            title="Tier progression"
            body="Higher tiers unlock better rates as verified activity grows."
          />
        </View>

        <Text style={styles.sectionTitle}>Your disclosure obligation</Text>
        <View style={styles.disclosureBox}>
          <Text style={styles.disclosureText}>{AMBASSADOR_DISCLOSURE}</Text>
        </View>

        <DisclosureCard
          tone="compliant"
          title="Why we require this"
          body="Paid promotion must be disclosed to your audience. Accepting stores a record of the exact terms you agreed to, which protects both you and the people who trust your recommendation."
        />

        <Pressable
          onPress={() => setAccepted((v) => !v)}
          accessibilityRole="checkbox"
          // accessibilityState alone does not emit aria-checked on react-native-web
          // 0.21, so a screen reader could not tell whether the disclosure had been
          // accepted — on a consent control, that is the one thing it must convey.
          accessibilityState={{ checked: accepted }}
          aria-checked={accepted}
          accessibilityLabel="I accept the ambassador disclosure"
          style={styles.acceptRow}
        >
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
            {accepted && <Check size={14} color={Colors.white} strokeWidth={3} />}
          </View>
          <Text style={styles.acceptText}>
            I have read and accept the disclosure above.
          </Text>
        </Pressable>

        <PrimaryButton
          label="Submit application"
          onPress={onSubmit}
          // The backend rejects an unaccepted disclosure with 400; gating here
          // makes that a visible precondition rather than a failed request.
          disabled={!accepted || apply.isPending}
          loading={apply.isPending}
        />
        <View style={styles.footerNote}>
          <ShieldCheck size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.footerNoteText}>
            Applications are reviewed manually. You can withdraw at any time by contacting support.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Perk({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={styles.perk}>
      <View style={styles.perkIcon}>{icon}</View>
      <View style={styles.perkBody}>
        <Text style={styles.perkTitle}>{title}</Text>
        <Text style={styles.perkText}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  banner: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  bannerIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  bannerTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bannerBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  perks: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  perk: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  perkIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  perkBody: { flex: 1 },
  perkTitle: { ...Typography.labelLg, color: Colors.onSurface },
  perkText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  disclosureBox: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  disclosureText: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 24 },
  acceptRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', paddingVertical: Spacing.xs },
  checkbox: {
    width: 22, height: 22, borderRadius: Radius.sm,
    borderWidth: 2, borderColor: Colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  acceptText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footerNote: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: Spacing.xs },
  footerNoteText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
});
