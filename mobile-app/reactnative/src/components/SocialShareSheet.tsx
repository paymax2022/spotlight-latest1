import React, { useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, Platform, Share, Linking } from 'react-native';
import { X, Copy, MessageCircle, Facebook, Send, Link2, Share2, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow3 } from '@/constants/shadows';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The share message (text). */
  message: string;
  /** Optional link appended to the message and used by url-based networks. */
  url?: string;
  title?: string;
}

const OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp',    icon: MessageCircle, color: '#25D366', bg: 'rgba(37,211,102,0.12)' },
  { id: 'facebook', label: 'Facebook',    icon: Facebook,      color: '#1877F2', bg: 'rgba(24,119,242,0.12)' },
  { id: 'twitter',  label: 'X',           icon: Link2,         color: Colors.onSurface, bg: Colors.surfaceContainerHigh },
  { id: 'telegram', label: 'Telegram',    icon: Send,          color: '#229ED9', bg: 'rgba(34,158,217,0.12)' },
  { id: 'copy',     label: 'Copy link',   icon: Copy,          color: Colors.primary, bg: Colors.iconBgPurple },
  { id: 'more',     label: 'More',        icon: Share2,        color: Colors.secondary, bg: Colors.iconBgBlue },
] as const;

// Open an external share-intent URL. On web this opens a new tab (react-native
// Linking would navigate the current tab); on native it hands off to the app.
function openExternal(url: string) {
  if (Platform.OS === 'web') {
    try { (globalThis as unknown as { open?: (u: string, t?: string) => void }).open?.(url, '_blank'); return; } catch { /* fall through */ }
  }
  Linking.openURL(url).catch(() => {});
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
    if (nav?.clipboard?.writeText) {
      try { await nav.clipboard.writeText(text); return true; } catch { /* fall through */ }
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(text); return true; }
  } catch { /* not installed */ }
  try { await Share.share({ message: text }); return true; } catch { return false; }
}

export default function SocialShareSheet({ visible, onClose, message, url, title = 'Share' }: Props) {
  const [copied, setCopied] = useState(false);
  const link = url ?? 'https://paymax.ng';
  const full = url ? `${message} ${url}` : message;

  const handle = async (id: (typeof OPTIONS)[number]['id']) => {
    switch (id) {
      case 'whatsapp':
        openExternal(`https://wa.me/?text=${encodeURIComponent(full)}`); onClose(); break;
      case 'facebook':
        openExternal(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encodeURIComponent(message)}`); onClose(); break;
      case 'twitter':
        openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(full)}`); onClose(); break;
      case 'telegram':
        openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`); onClose(); break;
      case 'copy': {
        const ok = await copyToClipboard(full);
        if (ok) { setCopied(true); setTimeout(() => { setCopied(false); onClose(); }, 900); }
        break;
      }
      case 'more':
        try { await Share.share({ message: full }); } catch { /* cancelled */ }
        onClose(); break;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, shadow3]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <X size={18} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>

          <Text style={styles.preview} numberOfLines={3}>{full}</Text>

          <View style={styles.grid}>
            {OPTIONS.map((opt) => {
              const isCopied = opt.id === 'copy' && copied;
              const Icon = isCopied ? Check : opt.icon;
              return (
                <Pressable key={opt.id} onPress={() => handle(opt.id)} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                  <View style={[styles.iconBox, { backgroundColor: isCopied ? 'rgba(22,163,74,0.12)' : opt.bg }]}>
                    <Icon size={24} color={isCopied ? '#16A34A' : opt.color} strokeWidth={1.8} />
                  </View>
                  <Text style={styles.optLabel}>{isCopied ? 'Copied' : opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  closeBtn: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.md, justifyContent: 'space-between' },
  option: { alignItems: 'center', gap: Spacing.xs, width: '30%' },
  pressed: { opacity: 0.7 },
  iconBox: { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  optLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
