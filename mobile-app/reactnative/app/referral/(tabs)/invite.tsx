import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  MessageCircle, Phone, Share2, Copy, Check, QrCode, Contact, Tag, Sparkles, TrendingUp, Grid3x3, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { COMPLIANT_EARN_SHORT } from '@/features/referral/constants/referral.constants';
import { useSharePayload } from '@/features/referral/invite/hooks';

// M-INV-01 — Invite friends (share sheet): WhatsApp / SMS / social / copy.
async function copyText(value: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(value); return true; }
  } catch { /* fall through */ }
  try { await Share.share({ message: value }); return true; } catch { return false; }
}

export default function ReferralInviteTab() {
  const { data, isLoading, isError, refetch } = useSharePayload();
  const [copied, setCopied] = useState(false);

  const onChannel = async (channel: 'whatsapp' | 'sms' | 'social' | 'copy') => {
    if (!data) return;
    if (channel === 'copy') {
      const ok = await copyText(data.link);
      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
      return;
    }
    // WhatsApp/SMS/social all route to the native share sheet (which lists the
    // installed apps); deep-link schemes can be layered on later.
    Share.share({ message: data.message }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Invite" showBack={false} showNotifications showHelp />
      {isLoading ? (
        <StateView kind="loading" message="Preparing your invite…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again in a moment." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard tone="compliant" title="Invite the honest way" body={COMPLIANT_EARN_SHORT} />

          {/* Code banner */}
          <View style={styles.codeBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>Your code</Text>
              <Text style={styles.codeValue}>{data.code}</Text>
            </View>
            <Pressable style={styles.codeCopy} onPress={() => onChannel('copy')} accessibilityRole="button" accessibilityLabel="Copy link">
              {copied ? <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : <Copy size={18} color={Colors.primary} strokeWidth={2} />}
              <Text style={styles.codeCopyText}>{copied ? 'Copied' : 'Copy link'}</Text>
            </Pressable>
          </View>

          {/* Channels */}
          <Text style={styles.sectionTitle}>Share via</Text>
          <View style={styles.channels}>
            <Channel icon={<MessageCircle size={22} color={Colors.tertiaryContainer} strokeWidth={2} />} label="WhatsApp" onPress={() => onChannel('whatsapp')} />
            <Channel icon={<Phone size={22} color={Colors.secondary} strokeWidth={2} />} label="SMS" onPress={() => onChannel('sms')} />
            <Channel icon={<Share2 size={22} color={Colors.primary} strokeWidth={2} />} label="Social" onPress={() => onChannel('social')} />
            <Channel icon={copied ? <Check size={22} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : <Copy size={22} color={Colors.onSurfaceVariant} strokeWidth={2} />} label={copied ? 'Copied' : 'Copy'} onPress={() => onChannel('copy')} />
          </View>

          {/* More ways to invite */}
          <Text style={styles.sectionTitle}>More ways to invite</Text>
          <View style={styles.linksCard}>
            <Row icon={<Contact size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Invite from contacts" sub="Pick people to invite (with consent)" onPress={() => router.push('/referral/invite/contact-picker')} />
            <Row icon={<QrCode size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Show QR code" sub="Scan-to-join, in person" onPress={() => router.push('/referral/invite/qr-code')} />
            <Row icon={<Sparkles size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Share by name" sub="Friends redeem with your name" onPress={() => router.push('/referral/invite/share-by-name')} />
            <Row icon={<Tag size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Custom / branded link" sub="Vanity link with source tags" onPress={() => router.push('/referral/invite/vanity-link')} />
            <Row icon={<Grid3x3 size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Refer to a specific service" sub="Property, bills, savings, mini-apps" onPress={() => router.push('/referral/invite/vertical-picker')} />
            <Row icon={<TrendingUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Track your invites" sub="Clicked → signed up → activated" onPress={() => router.push('/referral/invite/tracking')} last />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Channel({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.channel} onPress={onPress} accessibilityRole="button">
      <View style={styles.channelIcon}>{icon}</View>
      <Text style={styles.channelLabel}>{label}</Text>
    </Pressable>
  );
}

function Row({ icon, label, sub, onPress, last }: { icon: React.ReactNode; label: string; sub: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[styles.row, !last && styles.rowBorder]} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },
  codeBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  codeLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  codeValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const, letterSpacing: 1 },
  codeCopy: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full },
  codeCopyText: { ...Typography.labelMd, color: Colors.primary },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  channels: { flexDirection: 'row', gap: Spacing.sm },
  channel: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md },
  channelIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  channelLabel: { ...Typography.caption, color: Colors.onSurface },
  linksCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  rowSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
});
