import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, Animated, Easing, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { User, Heart, Bookmark, Bell, LifeBuoy, Flag, Ban, Tag, Package, ChevronRight, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const PANEL_W = Math.min(330, Math.round(Dimensions.get('window').width * 0.84));

interface MenuCtx { open: () => void; close: () => void; visible: boolean }
const Ctx = createContext<MenuCtx>({ open: () => {}, close: () => {}, visible: false });

/** Access the marketplace side-menu controls from any marketplace screen. */
export function useMarketplaceMenu() {
  return useContext(Ctx);
}

/** Wraps the marketplace navigator and renders the slide-in hamburger menu
 *  overlay. Holds the secondary destinations that don't belong in the 4-tab
 *  bottom bar. */
export function MarketplaceMenuProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  return (
    <Ctx.Provider value={{ open, close, visible }}>
      {children}
      <MarketplaceDrawer visible={visible} onClose={close} />
    </Ctx.Provider>
  );
}

function MarketplaceDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tx = useRef(new Animated.Value(-PANEL_W)).current;
  const scrim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(tx, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scrim, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, tx, scrim]);

  const animateClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(tx, { toValue: -PANEL_W, duration: 190, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 0, duration: 190, useNativeDriver: true }),
    ]).start(() => { setMounted(false); onClose(); });
  }, [tx, scrim, onClose]);

  const go = (path: string) => {
    animateClose();
    setTimeout(() => { try { router.push(path as never); } catch { /* noop */ } }, 200);
  };

  if (!visible && !mounted) return null;

  return (
    <Modal visible={visible || mounted} transparent animationType="none" onRequestClose={animateClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: scrim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={animateClose} accessibilityLabel="Close menu" />
        </Animated.View>

        <Animated.View style={[styles.panel, { width: PANEL_W, transform: [{ translateX: tx }] }]}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left']}>
            {/* Account header */}
            <Pressable style={styles.profile} onPress={() => go('/marketplace/account')}>
              <View style={styles.avatar}><User size={22} color={Colors.primary} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>Your account</Text>
                <Text style={styles.profileSub}>Profile, verification & settings</Text>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              <Section title="Activity">
                <Row icon={Heart} label="Saved items" onPress={() => go('/marketplace/saved-items')} />
                <Row icon={Bookmark} label="Saved searches" onPress={() => go('/marketplace/saved-searches')} />
                <Row icon={Bell} label="Notifications" onPress={() => go('/marketplace/account/notifications')} />
              </Section>

              <Section title="Selling">
                <Row icon={Tag} label="Sell an item" onPress={() => go('/marketplace/sell')} />
                <Row icon={Package} label="My deals" onPress={() => go('/marketplace/deals')} />
              </Section>

              <Section title="Support">
                <Row icon={LifeBuoy} label="Help & support" onPress={() => go('/marketplace/account/help')} />
                <Row icon={Flag} label="Report a problem" onPress={() => go('/marketplace/account/report')} />
                <Row icon={Ban} label="Blocked users" onPress={() => go('/marketplace/account/blocked')} />
              </Section>
            </ScrollView>

            <Pressable style={styles.closeBtn} onPress={animateClose} accessibilityLabel="Close menu">
              <X size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.closeLabel}>Close</Text>
            </Pressable>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ icon: Icon, label, onPress }: { icon: IconType; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.rowIcon}><Icon size={19} color={Colors.onSurface} strokeWidth={2} /></View>
      <Text style={styles.rowLabel}>{label}</Text>
      <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,28,48,0.45)' },
  panel: { height: '100%', backgroundColor: Colors.surfaceContainerLowest, borderTopRightRadius: Radius.lg, borderBottomRightRadius: Radius.lg, ...Platform_shadow() },
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  profileName: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  profileSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  scroll: { paddingBottom: Spacing.md },
  section: { marginTop: Spacing.md, paddingHorizontal: Spacing.sm },
  sectionTitle: { ...Typography.caption, color: Colors.onSurfaceVariant, letterSpacing: 1, marginLeft: Spacing.sm, marginBottom: 4 },
  sectionBody: { },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 12, paddingHorizontal: Spacing.sm, borderRadius: Radius.md },
  rowIcon: { width: 34, height: 34, borderRadius: Radius.sm, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, fontWeight: '600' as const },
  closeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  closeLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontWeight: '600' as const },
});

// Small cross-platform elevation without importing Platform at top scope twice.
function Platform_shadow() {
  return {
    shadowColor: '#0B1C30',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 16,
  } as const;
}
