import React from 'react';
import { View, Text, ScrollView, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users, BellRing } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { useConsent, useRecordConsent } from '@/features/referral/foundation/hooks';

// M-ONB-04 — Contacts/notification consent. NDPC-compliant, explicit, optional.
export default function ContactsConsent() {
  const { data, isLoading, isError, refetch } = useConsent();
  const record = useRecordConsent();

  const contactsOn = !!data?.contactsConsentAt;
  const nudgesOn = !!data?.nudgesConsentAt;

  const finish = () => router.replace('/referral/(tabs)/home');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Permissions" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load permissions" actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <DisclosureCard
              tone="info"
              title="Your choice, always"
              body="These permissions are optional. You can change them anytime in settings. We only use contacts to help you invite people you already know."
            />

            <Row
              icon={<Users size={20} color={Colors.secondary} strokeWidth={2} />}
              title="Access contacts"
              body="Let us suggest people to invite from your phone. We never message anyone without you choosing them."
              value={contactsOn}
              busy={record.isPending}
              onChange={(v) => record.mutate({ kind: 'contacts', granted: v })}
            />
            <Row
              icon={<BellRing size={20} color={Colors.primary} strokeWidth={2} />}
              title="Earning nudges"
              body="Get notified about signups, activations, vesting unlocks and payouts."
              value={nudgesOn}
              busy={record.isPending}
              onChange={(v) => record.mutate({ kind: 'nudges', granted: v })}
            />
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label="Continue" onPress={finish} />
            <PrimaryButton label="Not now" variant="ghost" onPress={finish} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Row({ icon, title, body, value, busy, onChange }: { icon: React.ReactNode; title: string; body: string; value: boolean; busy?: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Switch
        value={value}
        disabled={busy}
        onValueChange={onChange}
        trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
        thumbColor={Colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
});
