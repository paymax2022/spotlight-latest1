import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Copy, Share2, Check, Link2, QrCode } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import QrCodeView from '@/components/QrCodeView';
import { DisclosureCard } from '@/features/referral/components';
import { COMPLIANT_EARN_SHORT } from '@/features/referral/constants/referral.constants';
import { useMyCode } from '@/features/referral/home/hooks';

// M-HOME-02 — Personal code & link with copy + QR.
async function copyText(value: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(value); return true; }
  } catch { /* fall through */ }
  try { await Share.share({ message: value }); return true; } catch { return false; }
}

export default function MyCodeScreen() {
  const { data, isLoading, isError, refetch } = useMyCode();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const onCopy = async (kind: 'code' | 'link', value: string) => {
    const ok = await copyText(value);
    if (ok) { setCopied(kind); setTimeout(() => setCopied(null), 1800); }
  };

  const onShare = () => {
    if (!data) return;
    Share.share({ message: `Join me on Spotlight/Paymax — use my code ${data.code}: ${data.link}` }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My code & link" />
      {isLoading ? (
        <StateView kind="loading" message="Loading your code…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again in a moment." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard tone="compliant" body={COMPLIANT_EARN_SHORT} />

          {/* QR */}
          <View style={styles.qrCard}>
            <QrCodeView payload={data.link} size={196} />
            <Text style={styles.qrHint}>Scan to join with your code</Text>
          </View>

          {/* Code */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Your referral code</Text>
            <Pressable style={styles.copyRow} onPress={() => onCopy('code', data.code)} accessibilityRole="button">
              <Text style={styles.codeText}>{data.code}</Text>
              {copied === 'code' ? <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : <Copy size={18} color={Colors.primary} strokeWidth={2} />}
            </Pressable>
          </View>

          {/* Link */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Your invite link</Text>
            <Pressable style={styles.copyRow} onPress={() => onCopy('link', data.shortLink ?? data.link)} accessibilityRole="button">
              <Link2 size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.linkText} numberOfLines={1}>{data.shortLink ?? data.link}</Text>
              {copied === 'link' ? <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : <Copy size={18} color={Colors.primary} strokeWidth={2} />}
            </Pressable>
          </View>

          <Pressable style={styles.shareBtn} onPress={onShare} accessibilityRole="button">
            <Share2 size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.shareText}>Share invite</Text>
          </Pressable>

          <Pressable style={styles.secondary} onPress={() => router.push('/referral/invite/vanity-link')} accessibilityRole="button">
            <QrCode size={16} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.secondaryText}>Create a custom / branded link</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  qrCard: { alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg },
  qrHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  field: { gap: 6 },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  codeText: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const, letterSpacing: 1, flex: 1 },
  linkText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: Spacing.md },
  shareText: { ...Typography.labelLg, color: Colors.onPrimary },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  secondaryText: { ...Typography.labelMd, color: Colors.primary },
});
