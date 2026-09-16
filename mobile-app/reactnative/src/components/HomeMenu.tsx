// ── HomeMenu — global "back to the module grid" affordance ───────────────────
// A 20+ module app buries the user: from a rate-plan editor four screens deep
// inside Stays, getting home means tapping Back until it stops moving. This puts
// one hamburger at the top-right of every screen that opens a sheet whose primary
// action returns to the post-login landing screen.
//
// Coverage without touching 1,589 route files:
//   • ScreenHeader (1,007 screens) renders <HomeMenuButton /> in its header row,
//     beside whatever rightSlot the screen already passes — so it never covers a
//     screen's own actions.
//   • HomeMenuHost renders a floating fallback button for the ~590 screens with
//     bespoke headers, but ONLY when no header-hosted button is mounted. That is
//     what `registerHeaderButton` tracks; without it the two would double up.
//
// Any bespoke header can opt out of the floating button simply by rendering
// <HomeMenuButton /> itself, which is the preferred fix when the floating one
// lands on top of that screen's own controls.

import React, { useEffect, useSyncExternalStore } from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu, House, X } from 'lucide-react-native';
import { router, usePathname } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow3 } from '@/constants/shadows';

/**
 * The first screen after login. `(tabs)` is a route group so it does not appear
 * in the URL; the pathname for this route is "/home". Kept in one place because
 * both the navigation action and the "are we already there" check need it.
 */
export const HOME_ROUTE = '/(tabs)/home';
const HOME_PATHNAME = '/home';

/**
 * Kill switch. The menu is on by default — it is the feature — but a global
 * overlay across every screen is the kind of change worth being able to disable
 * without a rebuild of the calling screens. Only an explicit "false"/"0" is off.
 */
/**
 * Height of a typical header row (40pt control + its padding). The floating
 * fallback clears this so it never overlaps a screen's own top-right actions.
 */
const HEADER_BAND = 52;

const flag = process.env.EXPO_PUBLIC_GLOBAL_HOME_MENU;
const ENABLED = flag !== 'false' && flag !== '0';

/**
 * Screens where "go to the home grid" is meaningless or actively wrong: the user
 * is not past login yet, or is already standing on the destination. Matched on
 * the pathname, which excludes route groups like (auth) and (tabs).
 */
const SUPPRESSED = new Set([
  '/',
  HOME_PATHNAME,
  '/login',
  '/signup',
  '/register',
  '/onboarding',
  '/verify-otp',
  '/forgot-password',
  '/reset-password',
  '/module-unavailable',
]);

function useSuppressed(): boolean {
  const pathname = usePathname();
  return !ENABLED || SUPPRESSED.has(pathname);
}

// ── store ────────────────────────────────────────────────────────────────────
// A module-level store rather than context, mirroring lib/confirm and ToastHost:
// ScreenHeader can then render the button anywhere in the tree without every
// module layout having to add a provider.

let open = false;
let headerButtons = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getOpen = () => open;
const getHeaderButtons = () => headerButtons;

export function openHomeMenu() {
  if (!open) { open = true; emit(); }
}

export function closeHomeMenu() {
  if (open) { open = false; emit(); }
}

/**
 * Called by every header-hosted button while mounted. The floating fallback
 * renders only at zero, so a screen with a real header never gets both.
 */
function registerHeaderButton(): () => void {
  headerButtons += 1;
  emit();
  return () => { headerButtons -= 1; emit(); };
}

/**
 * Returns to the landing screen and drops the stack that led here, so Back from
 * home does not walk back into the module the user just left. dismissTo pops to
 * the home route when it is already below us and replaces when it is not, which
 * is both cases we care about; it throws outside a stack, hence the fallback.
 */
export function goHome() {
  closeHomeMenu();
  try {
    router.dismissTo(HOME_ROUTE as never);
  } catch {
    router.replace(HOME_ROUTE as never);
  }
}

// ── the hamburger ────────────────────────────────────────────────────────────

/**
 * The top-right hamburger. Rendered by ScreenHeader for the screens that use it,
 * and by HomeMenuHost as a floating control for those that do not.
 */
export function HomeMenuButton({ floating = false }: { floating?: boolean }) {
  const suppressed = useSuppressed();

  // Registration is what suppresses the floating fallback, so only the header
  // variant registers — a floating button must not hide itself.
  useEffect(() => {
    if (floating || suppressed) return;
    return registerHeaderButton();
  }, [floating, suppressed]);

  if (suppressed) return null;

  return (
    <Pressable
      onPress={openHomeMenu}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Open navigation menu"
      style={[styles.iconBtn, floating && styles.floatingBtn]}
    >
      <Menu size={22} color={Colors.onSurface} strokeWidth={2} />
    </Pressable>
  );
}

// ── the host ─────────────────────────────────────────────────────────────────

/**
 * Mounted once at the app root, beside ToastHost/ConfirmHost. Owns the sheet and
 * the floating fallback button.
 */
export default function HomeMenuHost() {
  const insets = useSafeAreaInsets();
  const suppressed = useSuppressed();
  const isOpen = useSyncExternalStore(subscribe, getOpen, getOpen);
  const inHeader = useSyncExternalStore(subscribe, getHeaderButtons, getHeaderButtons) > 0;

  // A route change can unmount the screen holding the sheet's trigger; close so
  // the sheet never outlives the screen it was opened from.
  const pathname = usePathname();
  useEffect(() => { closeHomeMenu(); }, [pathname]);

  if (!ENABLED) return null;

  return (
    <>
      {!suppressed && !inHeader ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.floatingWrap,
            // Sits BELOW the header band, not level with it. Screens with bespoke
            // headers put their own controls at the top-right — crowdfunding's
            // campaign page has Share and Save there — and a button level with
            // that row lands on top of them, which is worse than being slightly
            // lower. Verified against that screen: at header level it covered
            // Save outright. Bespoke headers that would rather have it inline can
            // render <HomeMenuButton /> themselves, which removes this fallback.
            { top: insets.top + HEADER_BAND, right: Spacing.containerMargin },
          ]}
        >
          <HomeMenuButton floating />
        </View>
      ) : null}

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={closeHomeMenu}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={closeHomeMenu} accessibilityLabel="Close menu" />
          <View style={[styles.sheet, shadow3]} accessibilityViewIsModal>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Go to</Text>
              <Pressable
                onPress={closeHomeMenu}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                style={styles.closeBtn}
              >
                <X size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            </View>

            <Pressable onPress={goHome} accessibilityRole="button" style={styles.item}>
              <View style={styles.itemIcon}>
                <House size={20} color={Colors.primary} strokeWidth={2} />
              </View>
              <View style={styles.itemText}>
                <Text style={styles.itemLabel}>Main home</Text>
                <Text style={styles.itemSub}>Back to the module grid</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  floatingWrap: { position: 'absolute', zIndex: 900 },
  floatingBtn: {
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outlineVariant,
  },

  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  itemIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1 },
  itemLabel: { ...Typography.labelLg, color: Colors.onSurface },
  itemSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
