import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Trophy, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import QrCodeView from '@/components/QrCodeView';
import { useMe } from '@/features/arena/hooks';
import type { Contestant } from '@/features/arena/types';

/**
 * C9 — Credential wallet. Renders the two verifiable credentials as cards with a
 * verify-QR + hash so anyone can scan/verify at /arena/verify?hash=…:
 *   · Certified Safe Driver — issued from a Play-Along pass threshold.
 *   · Naija Driver — issued on the crown (CROWNED).
 * Each card shows its status (ACTIVE / REVOKED). The credentials themselves come
 * from the identity graph; here we derive availability from the contestant state
 * and (for Certified Safe Driver) a passed Play-Along hash carried in params.
 */
export default function CredentialsScreen() {
  const params = useLocalSearchParams<{ competitionId?: string; safeDriverHash?: string }>();
  const competitionId = params.competitionId ?? '';
  const me = useMe(competitionId);

  const contestant = me.data?.contestant ?? null;

  // Certified Safe Driver may be earned by spectators too (via Play-Along); its
  // hash is passed from S3. Naija Driver requires CROWNED.
  const safeHash = params.safeDriverHash ?? null;
  const isCrowned = contestant?.state === 'CROWNED';

  if (me.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Credentials" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  const holderName = contestant?.displayName ?? 'You';
  const homeState = contestant?.homeState ?? undefined;

  const hasAny = !!safeHash || isCrowned;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Credential wallet" subtitle="Verifiable · revocable" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {!hasAny ? (
          <StateView
            kind="empty"
            icon="BadgeCheck"
            title="No credentials yet"
            message="Pass the Play-Along quiz to earn Certified Safe Driver, or win the crown to earn the Naija Driver credential."
          />
        ) : null}

        {safeHash ? (
          <CredentialCard
            variant="safe"
            title="Certified Safe Driver"
            holderName={holderName}
            homeState={homeState}
            hash={safeHash}
            status="ACTIVE"
          />
        ) : (
          <LockedCard title="Certified Safe Driver" hint="Pass the Play-Along quiz to earn this." />
        )}

        {isCrowned ? (
          <CredentialCard
            variant="naija"
            title="Naija Driver"
            holderName={holderName}
            homeState={homeState}
            hash={`ND-${contestant?.id ?? competitionId}`}
            status="ACTIVE"
          />
        ) : (
          <LockedCard title="Naija Driver" hint="Awarded to the crowned champion (Merit-decided)." />
        )}

        <Text style={styles.note}>
          Anyone can verify a credential without an account by scanning its QR. Credentials are independently
          revocable and do not affect your other Paymax capabilities.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function CredentialCard({
  variant, title, holderName, homeState, hash, status,
}: {
  variant: 'safe' | 'naija'; title: string; holderName: string; homeState?: string; hash: string; status: 'ACTIVE' | 'REVOKED';
}) {
  const Icon = variant === 'naija' ? Trophy : ShieldCheck;
  const accent = variant === 'naija' ? Colors.gold : Colors.teal;
  const verifyUrl = `/arena/verify?hash=${encodeURIComponent(hash)}`;
  return (
    <View style={[styles.card, shadow1, { borderColor: accent }]}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: `${accent}22` }]}><Icon size={24} color={accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardHolder}>{holderName}{homeState ? ` · ${homeState}` : ''}</Text>
        </View>
        <View style={[styles.statusPill, status === 'ACTIVE' ? styles.statusActive : styles.statusRevoked]}>
          <Text style={[styles.statusText, { color: status === 'ACTIVE' ? Colors.teal : Colors.error }]}>{status}</Text>
        </View>
      </View>
      <View style={styles.qrWrap}>
        <QrCodeView payload={verifyUrl} size={150} fill={variant === 'naija' ? Colors.primary : Colors.tertiary} />
      </View>
      <Text style={styles.hash} numberOfLines={1}>Hash: {hash}</Text>
    </View>
  );
}

function LockedCard({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={[styles.card, styles.locked]}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: Colors.surfaceContainerHigh }]}><BadgeCheck size={24} color={Colors.outline} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: Colors.onSurfaceVariant }]}>{title}</Text>
          <Text style={styles.cardHolder}>{hint}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1.5, gap: Spacing.md },
  locked: { borderColor: Colors.surfaceContainerHigh, borderStyle: 'dashed' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  cardIcon: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardHolder: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statusPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  statusActive: { backgroundColor: Colors.iconBgTeal },
  statusRevoked: { backgroundColor: Colors.errorContainer },
  statusText: { ...Typography.caption, fontWeight: '700' as const },
  qrWrap: { alignItems: 'center' },
  hash: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18, marginTop: Spacing.sm },
});
