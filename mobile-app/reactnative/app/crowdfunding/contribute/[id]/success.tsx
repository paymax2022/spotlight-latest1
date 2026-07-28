import React from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Share2, Receipt, Heart } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function SuccessScreen() {
  const { id, reference } = useLocalSearchParams<{ id: string; reference: string }>();

  const share = async () => {
    try {
      await Share.share({ message: `I just supported a campaign on Spotlight! Join me: https://spotlight.ng/c/${id}` });
    } catch { /* dismissed */ }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <CircleCheck size={56} color={Colors.tertiaryContainer} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Thank you for your support! 🎉</Text>
        <Text style={styles.sub}>Your contribution went through successfully. The creator and beneficiary are grateful for your generosity.</Text>

        <View style={styles.refCard}>
          <Heart size={16} color={Colors.error} fill={Colors.error} strokeWidth={2} />
          <Text style={styles.refText}>Reference · {reference}</Text>
        </View>

        <Pressable style={styles.shareBtn} onPress={share} accessibilityRole="button">
          <Share2 size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.shareText}>Share this campaign</Text>
        </Pressable>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.receiptBtn} onPress={() => router.replace(`/crowdfunding/contribute/${id}/receipt?reference=${reference}`)} accessibilityRole="button">
          <Receipt size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.receiptText}>View receipt</Text>
        </Pressable>
        <PrimaryButton label="Back to campaign" onPress={() => router.dismissTo(`/crowdfunding/campaign/${id}`)} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  refCard: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8, marginTop: Spacing.sm },
  refText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.sm },
  shareText: { ...Typography.labelLg, color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  receiptText: { ...Typography.labelLg, color: Colors.secondary },
});
