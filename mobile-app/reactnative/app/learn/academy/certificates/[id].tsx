import React from 'react';
import { View, Text, ScrollView, StyleSheet, Share, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldCheck, Share2, BadgeCheck, Briefcase, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import QrPlaceholder from '@/features/academy/components/QrPlaceholder';
import { useCredential } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';

/** S5 / G11 — Credential detail: verifiable cert + share/QR + verify link. */
export default function CredentialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cred = useCredential(id);

  if (cred.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading credential…" /></SafeAreaView>;
  if (cred.isError || !cred.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Not found" message="This credential is unavailable." /></SafeAreaView>;

  const c = cred.data;
  const onShare = () => {
    void Share.share({
      title: c.title,
      message: `I earned "${c.title}" from ${c.issuer}. Verify it: ${c.verifyUrl}`,
    }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Credential" rightSlot={<Pressable hitSlop={8} onPress={onShare}><Share2 size={20} color={Colors.onSurface} /></Pressable>} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Certificate card */}
        <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cert, shadow3]}>
          <View style={styles.certTop}>
            <BadgeCheck size={22} color={Colors.gold} />
            <Chip label={c.kind === 'trade' ? 'Trade credential' : 'Academic'} color={Colors.onPrimary} bg="rgba(255,255,255,0.18)" small />
          </View>
          <Text style={styles.certKicker}>CERTIFICATE OF ACHIEVEMENT</Text>
          <Text style={styles.certTitle}>{c.title}</Text>
          <Text style={styles.certName}>{c.recipientName}</Text>
          <Text style={styles.certIssuer}>{c.issuer}</Text>
          <Text style={styles.certDate}>Issued {formatDate(c.issuedAt)}{c.scorePct != null ? ` · ${c.scorePct}%` : ''}</Text>
        </LinearGradient>

        {/* QR + verify */}
        <View style={[styles.qrCard, shadow1]}>
          <QrPlaceholder value={c.verifyUrl} />
          <View style={styles.idRow}>
            <ShieldCheck size={14} color={Colors.teal} />
            <Text style={styles.idText}>ID {c.verificationId}</Text>
          </View>
          <PrimaryButton label="Verify this credential" onPress={() => router.push(`/learn/academy/certificates/verify/${c.verificationId}`)} variant="secondary" />
          <Text style={styles.hint}>Anyone can scan the QR or open the verify link to confirm this credential without contacting you.</Text>
        </View>

        {/* Earning bridge */}
        {c.unlocksRoles.length ? (
          <Pressable style={[styles.bridge, shadow1]} onPress={() => router.push('/learn/academy/earn')}>
            <View style={styles.bridgeIcon}><Briefcase size={20} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bridgeTitle}>Unlocks earning roles</Text>
              <Text style={styles.bridgeSub}>{c.unlocksRoles.join(', ')} · apply on Paymax</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>
        ) : null}

        <PrimaryButton label="Share credential" onPress={onShare} variant="ghost" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  cert: { borderRadius: Radius.xl, padding: Spacing.lg, gap: 2 },
  certTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  certKicker: { ...Typography.labelSm, color: Colors.gold, letterSpacing: 1.5, fontWeight: '700' },
  certTitle: { ...Typography.headlineMd, color: Colors.onPrimary, marginTop: 4 },
  certName: { ...Typography.titleLg, color: Colors.onPrimary, marginTop: Spacing.md },
  certIssuer: { ...Typography.bodyMd, color: Colors.inversePrimary, marginTop: 2 },
  certDate: { ...Typography.labelSm, color: Colors.inversePrimary, marginTop: 6 },
  qrCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, alignItems: 'center', gap: Spacing.sm },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  idText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  bridge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  bridgeIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  bridgeTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bridgeSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
