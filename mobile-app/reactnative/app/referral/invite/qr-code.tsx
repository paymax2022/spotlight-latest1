import React from 'react';
import { View, Text, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import QrCodeView from '@/components/QrCodeView';
import { useSharePayload } from '@/features/referral/invite/hooks';

// M-INV-04 — QR code for in-person / offline / agent contexts.
export default function QrCodeScreen() {
  const { data, isLoading, isError, refetch } = useSharePayload();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="QR code" />
      {isLoading ? (
        <StateView kind="loading" message="Generating QR…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <View style={styles.center}>
          <QrCodeView payload={data.link} size={240} />
          <Text style={styles.code}>{data.code}</Text>
          <Text style={styles.hint}>Ask a friend to scan this to join with your code. Great for in-person and agent sign-ups.</Text>
          <Pressable
            style={styles.shareBtn}
            onPress={() => Share.share({ message: data.message }).catch(() => {})}
            accessibilityRole="button"
          >
            <Share2 size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.shareText}>Share link instead</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: Spacing.md },
  code: { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '800' as const, letterSpacing: 2, marginTop: Spacing.sm },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, marginTop: Spacing.sm },
  shareText: { ...Typography.labelLg, color: Colors.onPrimary },
});
