import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, X, QrCode, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import BlackPerkCard from '@/features/loyalty/components/black-PerkCard';
import { useBlackPerks, useRedeemPerk } from '@/features/loyalty/black';
import { LoyaltyColors } from '@/features/loyalty/constants/loyalty.constants';
import type { PerkCredential } from '@/features/loyalty/black';

export default function BlackRedeem() {
  const perks = useBlackPerks();
  const redeem = useRedeemPerk();
  const [credential, setCredential] = useState<PerkCredential | null>(null);

  const onRedeem = async (perkId: string) => {
    const cred = await redeem.mutateAsync({ perkId });
    setCredential(cred);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Redeem a perk</Text>
        <View style={styles.iconBtn} />
      </View>

      {perks.isLoading ? (
        <StateView kind="loading" message="Loading perks…" />
      ) : perks.isError ? (
        <StateView kind="error" title="Couldn't load perks" actionLabel="Retry" onAction={() => perks.refetch()} />
      ) : (perks.data?.filter((p) => p.redeemable).length ?? 0) === 0 ? (
        <StateView kind="empty" title="No redeemable perks" message="Some perks (like zero fees) are always active and don't need redeeming." icon="Gift" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Redeem a perk to get a single-use credential you present at the venue.</Text>
          <View style={{ gap: Spacing.sm }}>
            {perks.data!.filter((p) => p.redeemable).map((p) => (
              <BlackPerkCard key={p.id} perk={p} onRedeem={() => onRedeem(p.id)} />
            ))}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}

      <Modal visible={!!credential} transparent animationType="fade" onRequestClose={() => setCredential(null)}>
        <View style={styles.backdrop}>
          <View style={styles.credCard}>
            <View style={styles.credHead}>
              <Text style={styles.credTitle}>Perk credential</Text>
              <Pressable onPress={() => setCredential(null)} hitSlop={10}><X size={22} color={LoyaltyColors.muted} /></Pressable>
            </View>
            <View style={styles.qrBox}><QrCode size={120} color={LoyaltyColors.text} /></View>
            <Text style={styles.credPerk}>{credential?.perkTitle}</Text>
            <Text style={styles.credToken}>{credential?.token}</Text>
            <View style={styles.credExpiry}><Clock size={13} color={LoyaltyColors.muted} /><Text style={styles.credExpiryText}>Single-use · expires {credential ? new Date(credential.expiresAtISO).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</Text></View>
            <PrimaryButton label="Done" onPress={() => setCredential(null)} style={{ marginTop: Spacing.md }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  intro: { ...Typography.bodyMd, color: LoyaltyColors.muted, marginBottom: Spacing.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.55)', justifyContent: 'center', padding: Spacing.lg },
  credCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 6 },
  credHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  credTitle: { ...Typography.titleLg, color: LoyaltyColors.text },
  qrBox: { backgroundColor: '#FFFFFF', padding: Spacing.md, borderRadius: Radius.lg, marginTop: Spacing.sm, borderWidth: 1, borderColor: LoyaltyColors.border },
  credPerk: { ...Typography.titleMd, color: LoyaltyColors.text, marginTop: Spacing.sm },
  credToken: { ...Typography.headlineMd, color: LoyaltyColors.brandText, letterSpacing: 1 },
  credExpiry: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  credExpiryText: { ...Typography.labelSm, color: LoyaltyColors.muted },
});
