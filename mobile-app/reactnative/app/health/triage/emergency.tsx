import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Siren, PhoneCall, MapPin, X, HeartPulse } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useNearestEmergency } from '@/features/triage/hooks';
import { useLanguage } from '@/features/triage/useLanguage';
import { t } from '@/features/triage/i18n';
import { track } from '@/features/triage/analytics';

/**
 * SC-8 — full-screen EMERGENCY / red-flag screen. Reached from the persistent
 * EmergencyFab on any screen, OR auto-routed when a deterministic red-flag fires
 * (SC-2) or the disposition is level 1/2. Big one-tap CALL AMBULANCE, nearest ER,
 * first-aid steps. Deliberately high-contrast red and free of distractions.
 */
export default function TriageEmergencyScreen() {
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const [lang] = useLanguage();
  const s = t(lang);
  const { data, isLoading, isError, refetch } = useNearestEmergency();

  useEffect(() => {
    track('red_flag_shown', { sessionId: params.sessionId });
  }, [params.sessionId]);

  const callAmbulance = () => {
    const num = data?.ambulance ?? 'tel:112';
    Linking.openURL(num).catch(() => {});
  };

  const openMap = () => {
    if (!data) return;
    const q = encodeURIComponent(data.erAddress);
    const url =
      data.lat && data.lng
        ? `https://maps.google.com/?q=${data.lat},${data.lng}`
        : `https://maps.google.com/?q=${q}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Dismiss (back to where the user was) */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" style={styles.closeBtn}>
          <X size={22} color={Colors.onPrimary} strokeWidth={2.5} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerIcon}>
          <Siren size={40} color={Colors.onPrimary} strokeWidth={2.5} />
        </View>
        <Text style={styles.title}>{s.emergencyTitle}</Text>
        <Text style={styles.subtitle}>{s.emergencySubtitle}</Text>

        {/* One-tap CALL AMBULANCE */}
        <Pressable onPress={callAmbulance} style={({ pressed }) => [styles.callBtn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={s.callAmbulance}>
          <PhoneCall size={24} color={Colors.error} strokeWidth={2.5} />
          <Text style={styles.callLabel}>{s.callAmbulance}</Text>
        </Pressable>

        {/* Nearest ER */}
        {isLoading ? (
          <View style={styles.card}>
            <StateView kind="loading" message="Finding nearest emergency room…" compact />
          </View>
        ) : isError || !data ? (
          <View style={styles.card}>
            <StateView kind="error" title="Couldn't load nearest ER" message="Call the ambulance above." actionLabel="Retry" onAction={refetch} compact />
          </View>
        ) : (
          <>
            <Pressable onPress={openMap} style={styles.card} accessibilityRole="button" accessibilityLabel={s.nearestEr}>
              <View style={styles.cardHead}>
                <MapPin size={18} color={Colors.error} strokeWidth={2.5} />
                <Text style={styles.cardTitle}>{s.nearestEr}</Text>
              </View>
              <Text style={styles.erName}>{data.erName}</Text>
              <Text style={styles.erAddr}>{data.erAddress}</Text>
              <Text style={styles.mapLink}>Open in maps</Text>
            </Pressable>

            {/* First-aid steps */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <HeartPulse size={18} color={Colors.error} strokeWidth={2.5} />
                <Text style={styles.cardTitle}>{s.firstAidTitle}</Text>
              </View>
              {data.firstAid.map((stepText, i) => (
                <View key={i} style={styles.aidRow}>
                  <View style={styles.aidNum}>
                    <Text style={styles.aidNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.aidText}>{stepText}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.disclaimer}>{s.disclaimer}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.error },
  topBar: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, alignItems: 'flex-end' },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.containerMargin, paddingBottom: 32, gap: Spacing.md, alignItems: 'center' },
  headerIcon: {
    width: 80, height: 80, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
  },
  title: { ...Typography.headlineLg, color: Colors.onPrimary, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onPrimary, textAlign: 'center', opacity: 0.95 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    width: '100%', minHeight: 64, backgroundColor: Colors.white, borderRadius: Radius.lg, marginTop: Spacing.sm,
  },
  pressed: { opacity: 0.9 },
  callLabel: { ...Typography.titleLg, color: Colors.error },
  card: {
    width: '100%', backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  erName: { ...Typography.titleMd, color: Colors.onSurface },
  erAddr: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  mapLink: { ...Typography.labelMd, color: Colors.secondary },
  aidRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  aidNum: {
    width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.errorContainer,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  aidNumText: { ...Typography.labelSm, color: Colors.error },
  aidText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, lineHeight: 22 },
  disclaimer: { ...Typography.caption, color: Colors.onPrimary, textAlign: 'center', opacity: 0.9, marginTop: Spacing.sm },
});
