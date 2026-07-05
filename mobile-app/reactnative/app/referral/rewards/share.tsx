import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Share, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Copy, Check, Share2, MessageCircle, Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import QrCodeView from '@/components/QrCodeView';
import { useReferralLink } from '@/features/referral/rewards/hooks';
import { shareMessage, RewardColors } from '@/features/referral/rewards/constants';
import { RewardHeader, Card } from '@/features/referral/rewards/components';

// Clipboard copy — mirrors the existing referral screens' guarded require so we
// don't hard-depend on expo-clipboard (falls back to the native share sheet).
async function copyText(value: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(value); return true; }
  } catch { /* fall through */ }
  try { await Share.share({ message: value }); return true; } catch { return false; }
}

// PRD §5.1.2 — Share / Invite. Code + shareable link, QR, one-tap share
// (WhatsApp first — the dominant channel in Nigeria — then SMS/social via the
// native share sheet).
export default function ShareInvite() {
  const { data, isLoading, isError, refetch } = useReferralLink();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const code = data?.code ?? '';
  const link = code ? `https://spotlight.ng/j/${code}` : '';
  const message = shareMessage(code, link);

  const copy = async (kind: 'code' | 'link') => {
    const ok = await copyText(kind === 'code' ? code : link);
    if (ok) { setCopied(kind); setTimeout(() => setCopied(null), 1500); }
  };

  const nativeShare = async () => {
    try {
      await Share.share(Platform.OS === 'ios' ? { message, url: link } : { message: `${message}` });
    } catch { /* user dismissed */ }
  };

  const shareWhatsApp = async () => {
    const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (ok) { Linking.openURL(url).catch(() => nativeShare()); } else { nativeShare(); }
  };

  const shareSms = async () => {
    const sep = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${sep}body=${encodeURIComponent(message)}`;
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (ok) { Linking.openURL(url).catch(() => nativeShare()); } else { nativeShare(); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <RewardHeader title="Share your invite" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !code ? (
        <StateView kind="error" title="Couldn't load your code" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* QR */}
          <View style={styles.qrWrap}>
            <QrCodeView payload={link} size={188} />
            <Text style={styles.qrHint}>Scan to sign up with your code</Text>
          </View>

          {/* Code */}
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>Your referral code</Text>
            <View style={styles.copyRow}>
              <Text style={styles.code}>{code}</Text>
              <Pressable style={styles.copyBtn} onPress={() => copy('code')} accessibilityRole="button" accessibilityLabel="Copy code">
                {copied === 'code' ? <Check size={18} color={RewardColors.ok} strokeWidth={2.2} /> : <Copy size={18} color={Colors.primary} strokeWidth={2} />}
              </Pressable>
            </View>
          </Card>

          {/* Link */}
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>Shareable link</Text>
            <View style={styles.copyRow}>
              <Text style={styles.link} numberOfLines={1}>{link}</Text>
              <Pressable style={styles.copyBtn} onPress={() => copy('link')} accessibilityRole="button" accessibilityLabel="Copy link">
                {copied === 'link' ? <Check size={18} color={RewardColors.ok} strokeWidth={2.2} /> : <Copy size={18} color={Colors.primary} strokeWidth={2} />}
              </Pressable>
            </View>
          </Card>

          {/* Share channels — WhatsApp first */}
          <Pressable style={[styles.channel, styles.whatsapp]} onPress={shareWhatsApp} accessibilityRole="button">
            <MessageCircle size={20} color={Colors.white} strokeWidth={2} />
            <Text style={styles.channelText}>Share on WhatsApp</Text>
          </Pressable>
          <View style={styles.channelRow}>
            <Pressable style={[styles.channelSm]} onPress={shareSms} accessibilityRole="button">
              <Send size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.channelSmText}>SMS</Text>
            </Pressable>
            <Pressable style={[styles.channelSm]} onPress={nativeShare} accessibilityRole="button">
              <Share2 size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.channelSmText}>More</Text>
            </Pressable>
          </View>

          <Text style={styles.footNote}>
            You earn a share of the platform margin whenever someone who signs up with your code makes a
            purchase — never just for signing up.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  qrHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  card: { gap: Spacing.sm },
  cardLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  code: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800', letterSpacing: 1, flex: 1 },
  link: { ...Typography.bodyMd, color: Colors.secondary, flex: 1 },
  copyBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  channel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: 14, borderRadius: Radius.full },
  whatsapp: { backgroundColor: '#25D366' },
  channelText: { ...Typography.labelLg, color: Colors.white, fontWeight: '700' },
  channelRow: { flexDirection: 'row', gap: Spacing.md },
  channelSm: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: 12, borderRadius: Radius.full, borderWidth: 1.5, borderColor: RewardColors.border, backgroundColor: RewardColors.surface },
  channelSmText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
  footNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 20 },
});
