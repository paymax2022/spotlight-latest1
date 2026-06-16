import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, Platform, Share, Linking } from 'react-native';
import { X, Copy, MessageCircle, Instagram, Facebook, Link2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow3 } from '@/constants/shadows';

interface Props {
  visible: boolean;
  onClose: () => void;
  contestantName: string;
  shareUrl?: string;
  shareText?: string;
}

const SHARE_OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp',  icon: MessageCircle, color: '#25D366', bg: 'rgba(37,211,102,0.12)' },
  { id: 'instagram', label: 'Instagram', icon: Instagram,    color: '#E1306C', bg: 'rgba(225,48,108,0.12)' },
  { id: 'facebook',  label: 'Facebook',  icon: Facebook,     color: '#1877F2', bg: 'rgba(24,119,242,0.12)' },
  { id: 'twitter',   label: 'X (Twitter)', icon: Link2,      color: Colors.onSurface, bg: Colors.surfaceContainerHigh },
  { id: 'copy',      label: 'Copy Link',   icon: Copy,       color: Colors.primary,   bg: Colors.iconBgPurple },
];

export default function ShareBottomSheet({ visible, onClose, contestantName, shareUrl, shareText }: Props) {
  const text = shareText ?? `Vote for ${contestantName} in the Spotlight Contest! 🎤 ${shareUrl ?? 'https://spotlight.ng'}`;

  const handleShare = async (id: string) => {
    try {
      if (id === 'copy') {
        // clipboard — requires expo-clipboard which may not be installed; fallback to Share
        await Share.share({ message: shareUrl ?? text });
      } else if (id === 'whatsapp') {
        const url = `whatsapp://send?text=${encodeURIComponent(text)}`;
        const can = await Linking.canOpenURL(url);
        if (can) await Linking.openURL(url);
        else await Share.share({ message: text });
      } else {
        await Share.share({ message: text, url: shareUrl });
      }
    } catch { /* user cancelled or error */ }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, shadow3]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Share {contestantName}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>

          <Text style={styles.preview} numberOfLines={3}>{text}</Text>

          <View style={styles.grid}>
            {SHARE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                onPress={() => handleShare(opt.id)}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              >
                <View style={[styles.iconBox, { backgroundColor: opt.bg }]}>
                  <opt.icon size={24} color={opt.color} strokeWidth={1.8} />
                </View>
                <Text style={styles.optLabel}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:  { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius:  Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal:    Spacing.lg,
    paddingBottom:        Platform.OS === 'ios' ? 34 : 24,
  },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  title:    { ...Typography.titleMd, color: Colors.onSurface },
  closeBtn: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  preview:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg, lineHeight: 20 },
  grid:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'space-between' },
  option:   { alignItems: 'center', gap: Spacing.xs, width: '18%' },
  pressed:  { opacity: 0.7 },
  iconBox:  { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  optLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
