import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, Mail, Phone, BadgeCheck, Gauge } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { useInvestProfile } from '@/features/investsettings/hooks/useSettings';
import { KYC_TIER_META, RISK_CATEGORY_META } from '@/features/investsettings/constants/settings.constants';

export default function ProfileScreen() {
  const { data, isLoading, isError, refetch } = useInvestProfile();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile" subtitle="Identity, KYC & risk" />

      {isLoading ? (
        <StateView kind="loading" message="Loading profile…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load profile" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <SectionHeader title="Personal details" />
          <View style={styles.group}>
            <Field icon={<User size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />} label="Full name" value={data.name} />
            <Field icon={<Mail size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />} label="Email" value={data.email} />
            <Field icon={<Phone size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />} label="Phone" value={data.phone} last />
          </View>

          <SectionHeader title="Verification" style={styles.sectionHeader} />
          <View style={styles.statusCard}>
            <View style={styles.statusIcon}>
              <BadgeCheck size={22} color={Colors.secondary} strokeWidth={1.8} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.statusTitle}>{KYC_TIER_META[data.kycTier].label}</Text>
              <Text style={styles.statusDesc}>{KYC_TIER_META[data.kycTier].description}</Text>
            </View>
          </View>

          <SectionHeader title="Risk profile" style={styles.sectionHeader} />
          <View style={styles.statusCard}>
            <View style={[styles.statusIcon, { backgroundColor: Colors.iconBgTeal }]}>
              <Gauge size={22} color={Colors.teal} strokeWidth={1.8} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.statusTitle}>{RISK_CATEGORY_META[data.riskCategory].label}</Text>
              <Text style={styles.statusDesc}>{RISK_CATEGORY_META[data.riskCategory].description}</Text>
            </View>
          </View>

          <Text style={styles.note}>
            These details are managed by compliance. Contact support to request a change.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Field({ icon, label, value, last }: { icon: React.ReactNode; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.fieldBorder]}>
      <View style={styles.fieldIcon}>{icon}</View>
      <View style={styles.flex}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  sectionHeader: { marginTop: Spacing.sm },
  group: {
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden',
  },
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  fieldIcon: { width: 28, alignItems: 'center' },
  fieldLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fieldValue: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  statusIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue,
  },
  flex: { flex: 1 },
  statusTitle: { ...Typography.labelLg, color: Colors.onSurface },
  statusDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  note: {
    ...Typography.bodySm, color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.xs,
  },
});
