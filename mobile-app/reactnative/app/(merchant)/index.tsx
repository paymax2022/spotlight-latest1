import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Store, ChevronRight, Sparkles } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { CapabilityRow } from '@/features/merchant/components';
import { useCapabilities } from '@/features/merchant/hooks/useMerchant';
import { APP_STATUS_DISPLAY, PROFILE_STATUS_DISPLAY } from '@/features/merchant/constants/statusDisplay';
import { getMyBusinesses, isBusinessActive } from '@/api/business.api';
import { confirmAsync } from '@/lib/confirm';

// Screen: Capabilities dashboard + context switcher (PRD §6.3, FR-25/FR-26).
// One identity, many capabilities — Customer is always present; each approved
// merchant profile and each in-flight application is listed with its status.
export default function CapabilitiesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useCapabilities();

  // Business-registry gate (customer → merchant upgrade). A user cannot become a
  // merchant/provider until they have a verified or registered business with CAC.
  // We fail OPEN on load/error so a business-API outage never blocks the flow.
  const businessQuery = useQuery({ queryKey: ['business', 'me'], queryFn: getMyBusinesses });

  const handleUpgrade = async () => {
    const businesses = businessQuery.data;
    const hasActiveBusiness = !businesses || businesses.some(isBusinessActive);
    if (hasActiveBusiness) {
      router.push('/(merchant)/modules');
      return;
    }
    const ok = await confirmAsync({
      title: 'Business required',
      message: 'Becoming a merchant or service provider requires a CAC-registered or verified business. Set one up first — it only takes a few minutes.',
      confirmLabel: 'Set up business',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    router.push('/profile/business');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your capabilities" subtitle="Customer + provider workspaces" />

      {isLoading && !data ? (
        <StateView kind="loading" message="Loading your capabilities" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load capabilities" message="Please check your connection and try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={Colors.primary} />}
        >
          {/* Upgrade CTA — persistent entry point (FR-4) */}
          <Pressable
            onPress={handleUpgrade}
            style={({ pressed }) => [styles.cta, shadow1, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Become a merchant or service provider"
          >
            <View style={styles.ctaIcon}>
              <Store size={24} color={Colors.onPrimary} strokeWidth={2} />
            </View>
            <View style={styles.ctaBody}>
              <Text style={styles.ctaTitle}>Become a Merchant / Provider</Text>
              <Text style={styles.ctaSub}>Add a selling or service capability to your account</Text>
            </View>
            <ChevronRight size={20} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>

          {/* Switcher — Customer + each provider workspace */}
          <SectionHeader title="Switch workspace" style={styles.sectionFirst} />
          <View style={styles.group}>
            <CapabilityRow
              icon={data.customer.icon}
              label={data.customer.label}
              sublabel={data.customer.sublabel}
              statusLabel="Active"
              statusTone="success"
              active
              onPress={() => router.replace('/(tabs)/home')}
            />
            {data.merchants.map((m) => {
              const s = PROFILE_STATUS_DISPLAY[m.status];
              return (
                <CapabilityRow
                  key={m.id}
                  icon={m.icon}
                  label={m.merchantTypeName}
                  sublabel={m.moduleName}
                  statusLabel={s.label}
                  statusTone={s.tone}
                  onPress={() => router.push(m.workspaceRoute as never)}
                />
              );
            })}
          </View>

          {/* In-flight applications (FR-25) */}
          {data.activeApplications.length > 0 && (
            <>
              <SectionHeader title="Applications in progress" style={styles.section} />
              <View style={styles.group}>
                {data.activeApplications.map((a) => {
                  const s = APP_STATUS_DISPLAY[a.status];
                  return (
                    <CapabilityRow
                      key={a.id}
                      icon="FileClock"
                      label={a.merchantTypeName}
                      sublabel={a.moduleName}
                      statusLabel={s.label}
                      statusTone={s.tone}
                      onPress={() => router.push(`/(merchant)/application/${a.id}`)}
                    />
                  );
                })}
              </View>
            </>
          )}

          {/* Empty state for a brand-new customer with no profiles/applications */}
          {data.merchants.length === 0 && data.activeApplications.length === 0 && (
            <View style={styles.emptyHint}>
              <Sparkles size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.emptyHintText}>
                You're a Customer today. Tap “Become a Merchant / Provider” to start earning.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  cta:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  pressed:     { opacity: 0.9 },
  ctaIcon:     { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  ctaBody:     { flex: 1, gap: 2 },
  ctaTitle:    { ...Typography.titleMd, color: Colors.onPrimary },
  ctaSub:      { ...Typography.labelSm, color: Colors.inverseOnSurface },
  sectionFirst:{ paddingHorizontal: 0, marginBottom: Spacing.sm },
  section:     { paddingHorizontal: 0, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  group:       { gap: 0 },
  emptyHint:   { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  emptyHintText:{ ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
