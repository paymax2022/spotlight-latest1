import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Star, MapPin, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { CredentialBadge } from '@/features/health/components';
import { useProvider } from '@/features/health/hooks';
import { VERTICAL_META, formatNaira } from '@/features/health/constants/health.constants';

export default function ProviderProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: provider, isLoading, isError, refetch } = useProvider(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Provider" />

      {isLoading ? (
        <StateView kind="loading" message="Loading provider…" />
      ) : isError || !provider ? (
        <StateView kind="error" title="Provider not found" message="This provider may no longer be active." actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {(() => {
              const vMeta = VERTICAL_META[provider.vertical];
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[vMeta.icon] ?? Icons.Activity;
              return (
                <View style={[styles.header, shadow1]}>
                  <View style={[styles.avatar, { backgroundColor: vMeta.iconBg }]}>
                    <Icon size={28} color={vMeta.color} strokeWidth={2} />
                  </View>
                  <Text style={styles.name}>{provider.name}</Text>
                  <Text style={styles.headline}>{provider.headline}</Text>

                  {/* Verified-credential badge (HL-2) */}
                  <CredentialBadge credential={provider.credential} showLicense />

                  <View style={styles.statRow}>
                    <View style={styles.stat}>
                      <Star size={14} color={Colors.gold} strokeWidth={2.2} />
                      <Text style={styles.statText}>
                        {provider.rating.toFixed(1)} ({provider.reviewCount})
                      </Text>
                    </View>
                    <View style={styles.stat}>
                      <MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                      <Text style={styles.statText}>{provider.location}</Text>
                    </View>
                  </View>
                </View>
              );
            })()}

            {/* Verification assurance (HL-2) */}
            <View style={styles.verify}>
              <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.verifyText}>
                This provider is verified by {provider.credential.authority} and is only discoverable while their
                licence is active.
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>About</Text>
              <Text style={styles.body}>{provider.bio}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Specialties</Text>
              <View style={styles.chips}>
                {provider.specialties.map((s) => (
                  <View key={s} style={styles.chip}>
                    <Text style={styles.chipText}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Fee</Text>
              <Text style={styles.fee}>{formatNaira(provider.baseFeeKobo)}</Text>
              <Text style={styles.feeNote}>Consult / visit base fee · payment held until completed</Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label="Book with this provider"
              onPress={() => router.push(VERTICAL_META[provider.vertical].href as never)}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  header: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  avatar: { width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  name: { ...Typography.headlineMd, fontSize: 22, color: Colors.onSurface },
  headline: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
  statRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { ...Typography.labelSm, color: Colors.onSurface },
  verify: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  verifyText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 16 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.sm + 2, paddingVertical: 5 },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  fee: { ...Typography.headlineMd, fontSize: 24, color: Colors.primary },
  feeNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
