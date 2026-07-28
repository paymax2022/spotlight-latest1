import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SectionHeader from '@/components/SectionHeader';
import DetailRow from '@/features/realtor/components/DetailRow';
import { useApplyStore, EMPLOYMENT_OPTIONS } from '@/features/realtor/store/applyStore';
import { useListing, useCreateApplication } from '@/features/realtor/hooks/useRealtor';
import { formatNaira, priceLabelFull } from '@/features/realtor/utils/realtorFormatters';

export default function ApplyReviewScreen() {
  const { draft, reset } = useApplyStore();
  const listing = useListing(draft.listingId);
  const createApp = useCreateApplication();
  const [error, setError] = React.useState<string>();

  const submit = async () => {
    setError(undefined);
    try {
      const app = await createApp.mutateAsync(draft);
      reset();
      router.replace(`/realtor/apply/submitted?id=${app.id}`);
    } catch {
      setError('Could not submit your application. Please try again.');
    }
  };

  const employmentLabel = EMPLOYMENT_OPTIONS.find((o) => o.value === draft.employmentStatus)?.label ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review application" subtitle="Check before you submit" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {listing.data ? (
          <View style={styles.listingCard}>
            <Image source={{ uri: listing.data.media[0] }} style={styles.thumb} />
            <View style={styles.listingInfo}>
              <Text style={styles.listingTitle} numberOfLines={2}>{listing.data.title}</Text>
              <Text style={styles.listingPrice}>{priceLabelFull(listing.data)}</Text>
            </View>
          </View>
        ) : null}

        <SectionHeader title="Applicant" style={styles.sectionFlush} />
        <View style={styles.card}>
          <DetailRow label="Full name" value={draft.fullName} />
          <DetailRow label="Email" value={draft.email} />
          <DetailRow label="Phone" value={draft.phone} />
          <DetailRow label="Occupants" value={String(draft.occupants)} />
          {draft.moveInDate ? <DetailRow label="Move-in" value={draft.moveInDate} /> : null}
        </View>

        <SectionHeader title="Employment & income" style={styles.sectionFlush} />
        <View style={styles.card}>
          <DetailRow label="Status" value={employmentLabel} />
          {draft.employerName ? <DetailRow label="Employer" value={draft.employerName} /> : null}
          <DetailRow label="Monthly income" value={formatNaira(draft.monthlyIncome)} />
        </View>

        <SectionHeader title="Guarantor" style={styles.sectionFlush} />
        <View style={styles.card}>
          <DetailRow label="Name" value={draft.guarantorName} />
          <DetailRow label="Phone" value={draft.guarantorPhone} />
          <DetailRow label="Relationship" value={draft.guarantorRelationship || '—'} />
        </View>

        {listing.data ? (
          <>
            <SectionHeader title="Move-in cost" style={styles.sectionFlush} />
            <View style={styles.card}>
              <DetailRow label="Rent" value={priceLabelFull(listing.data)} />
              {listing.data.cautionDeposit ? (
                <DetailRow label="Caution deposit" value={formatNaira(listing.data.cautionDeposit)} refundable />
              ) : null}
            </View>
            {listing.data.escrowProtected ? (
              <View style={styles.escrowNote}>
                <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
                <Text style={styles.escrowText}>
                  No payment is taken now. Rent & deposit are only collected after the landlord approves and the lease is signed — your deposit is held in escrow.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit application" onPress={submit} loading={createApp.isPending} />
        <Text style={styles.footerHint}>You can withdraw any time before approval.</Text>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  listingCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  listingInfo: { flex: 1, justifyContent: 'center', gap: 4 },
  listingTitle: { ...Typography.labelLg, color: Colors.onSurface },
  listingPrice: { ...Typography.titleMd, color: Colors.primary },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  escrowNote: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  escrowText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
    backgroundColor: Colors.surfaceContainerLowest,
    gap: Spacing.xs,
  },
  footerHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
