import React from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, Link2, MessageCircle, Facebook, Twitter, Linkedin, QrCode } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { recordCampaignEvent } from '@/features/crowdfunding/api/crowdfunding.api';

const CHANNELS = [
  { key: 'copy', label: 'Copy link', icon: Link2, bg: Colors.iconBgPurple, fg: Colors.primary },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, bg: Colors.iconBgGreen, fg: '#0F7A37' },
  { key: 'facebook', label: 'Facebook', icon: Facebook, bg: Colors.iconBgBlue, fg: Colors.secondary },
  { key: 'x', label: 'X', icon: Twitter, bg: Colors.surfaceContainerHigh, fg: Colors.onSurface },
  { key: 'linkedin', label: 'LinkedIn', icon: Linkedin, bg: Colors.iconBgBlue, fg: Colors.secondary },
  { key: 'qr', label: 'QR code', icon: QrCode, bg: Colors.surfaceContainerHigh, fg: Colors.onSurface },
];

export default function ShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c } = useCampaign(id);
  const url = `https://spotlight.ng/c/${id}`;

  const onChannel = async (key: string) => {
    // Record the share against the channel the creator will see in their
    // traffic-source breakdown. 'copy' and 'qr' produce a link with no channel
    // of its own, so they count as 'direct'. Fired before the native sheet
    // because we cannot tell whether the user completed or dismissed it, and an
    // intent to share is the signal the creator cares about.
    void recordCampaignEvent(id, 'SHARE', key === 'copy' || key === 'qr' ? 'direct' : key);

    if (key === 'whatsapp' || key === 'facebook' || key === 'x' || key === 'linkedin') {
      try {
        await Share.share({ message: `${c?.title ?? 'Support this campaign'} — ${url}`, url });
      } catch { /* user dismissed */ }
    }
    // copy / qr would use Clipboard / a QR sheet in production
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <Text style={styles.title}>Share campaign</Text>
        <Pressable onPress={() => goBack('/crowdfunding')} hitSlop={10} accessibilityLabel="Close"><X size={22} color={Colors.onSurface} strokeWidth={2} /></Pressable>
      </View>

      <Text style={styles.subtitle} numberOfLines={2}>{c?.title ?? 'Help this campaign reach more supporters.'}</Text>

      <View style={styles.grid}>
        {CHANNELS.map((ch) => {
          const Icon = ch.icon;
          return (
            <Pressable key={ch.key} style={styles.channel} onPress={() => onChannel(ch.key)} accessibilityRole="button" accessibilityLabel={`Share via ${ch.label}`}>
              <View style={[styles.channelIcon, { backgroundColor: ch.bg }]}><Icon size={22} color={ch.fg} strokeWidth={2} /></View>
              <Text style={styles.channelLabel}>{ch.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.linkBox}>
        <Text style={styles.linkText} numberOfLines={1}>{url}</Text>
        <Pressable style={styles.copyBtn} onPress={() => onChannel('copy')} accessibilityRole="button"><Text style={styles.copyText}>Copy</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  grabber: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginTop: Spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.containerMargin, paddingBottom: Spacing.xs },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.lg, gap: Spacing.md },
  channel: { alignItems: 'center', gap: 6, width: 72 },
  channelIcon: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  channelLabel: { ...Typography.labelSm, color: Colors.onSurface },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.sm, paddingLeft: Spacing.md },
  linkText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  copyBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  copyText: { ...Typography.labelMd, color: Colors.onPrimary },
});
