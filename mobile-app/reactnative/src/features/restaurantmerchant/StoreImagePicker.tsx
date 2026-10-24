import React, { useState } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Camera, Store } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { useUpdateStore } from './hooks';
import { StoreImageUploadsUnavailableError } from './api';
import { pickStoreImage, uploadStoreImage, StoreImageError, type PickedStoreImage } from './storeImageUpload';

/** The two storefront pictures — the same layout serves both an existing outlet (upload
 *  straight away) and set-up (hold the pick until the outlet exists). */
type FacadeKind = 'logo' | 'banner';

/**
 * The banner and logo themselves: two tap targets over one picture of the storefront,
 * the wide banner with the square logo sitting on its corner, plus the hint about sizes
 * and the error line. Shared so the two pickers below cannot drift apart in look.
 */
function StorefrontFacade({
  bannerUri, logoUri, busy, error, onPressKind, onBroken,
}: {
  bannerUri?: string | null;
  logoUri?: string | null;
  busy: FacadeKind | null;
  error: string | null;
  onPressKind: (kind: FacadeKind) => void;
  onBroken?: (kind: FacadeKind) => void;
}) {
  const showBanner = !!bannerUri;
  const showLogo = !!logoUri;
  return (
    <View style={styles.wrap}>
      <View>
        <Pressable
          onPress={() => onPressKind('banner')}
          style={styles.banner}
          accessibilityRole="button"
          accessibilityLabel={showBanner ? 'Change banner picture' : 'Add a banner picture'}
        >
          {showBanner ? (
            <Image
              source={{ uri: bannerUri! }}
              style={styles.bannerImg}
              resizeMode="cover"
              onError={() => onBroken?.('banner')}
            />
          ) : (
            <View style={styles.bannerEmpty}>
              <Camera size={22} color={Colors.primary} />
              <Text style={styles.emptyText}>Add a banner</Text>
            </View>
          )}
          <View style={styles.badge}>
            {busy === 'banner'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Camera size={14} color="#fff" />}
          </View>
        </Pressable>

        <Pressable
          onPress={() => onPressKind('logo')}
          style={styles.logo}
          accessibilityRole="button"
          accessibilityLabel={showLogo ? 'Change logo' : 'Add a logo'}
        >
          {showLogo ? (
            <Image
              source={{ uri: logoUri! }}
              style={styles.logoImg}
              resizeMode="cover"
              onError={() => onBroken?.('logo')}
            />
          ) : (
            <Store size={26} color={Colors.primary} />
          )}
          <View style={[styles.badge, styles.logoBadge]}>
            {busy === 'logo'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Camera size={12} color="#fff" />}
          </View>
        </Pressable>
      </View>

      <Text style={styles.hint}>Banner is wide (16:9), logo is square. PNG, JPG or WEBP, up to 8 MB.</Text>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

/**
 * The store's banner and logo, with a way to change each. Tapping either opens the photo
 * library; the chosen picture is uploaded straight to storage and then saved on the store.
 * A picture whose (signed, short-lived) address has lapsed falls back to the placeholder
 * rather than a broken image — re-opening the screen fetches fresh ones.
 */
export default function StoreImagePicker({
  storeId, logoUrl, bannerUrl,
}: {
  storeId: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
}) {
  const update = useUpdateStore(storeId);
  const [busy, setBusy] = useState<FacadeKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A signed URL that has lapsed renders nothing; hide that picture and show the
  // placeholder until the store is re-read.
  const [broken, setBroken] = useState<Record<FacadeKind, boolean>>({ logo: false, banner: false });

  const change = async (kind: FacadeKind) => {
    if (busy) return;
    setError(null);
    try {
      const file = await pickStoreImage(kind);
      if (!file) return; // cancelled
      setBusy(kind);
      const key = await uploadStoreImage(storeId, kind, file);
      await update.mutateAsync(kind === 'logo' ? { logoUrl: key } : { bannerUrl: key });
      setBroken((b) => ({ ...b, [kind]: false }));
    } catch (e) {
      if (e instanceof StoreImageError || e instanceof StoreImageUploadsUnavailableError) {
        setError(e.message);
      } else {
        setError('Couldn’t update the picture. Check your connection and try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <StorefrontFacade
      bannerUri={broken.banner ? null : bannerUrl}
      logoUri={broken.logo ? null : logoUrl}
      busy={busy}
      error={error}
      onPressKind={change}
      onBroken={(kind) => setBroken((b) => ({ ...b, [kind]: true }))}
    />
  );
}

export interface StorefrontDraft {
  logo: PickedStoreImage | null;
  banner: PickedStoreImage | null;
}

export const emptyStorefrontDraft = (): StorefrontDraft => ({ logo: null, banner: null });

/**
 * The same banner + logo pickers for a store that DOESN'T EXIST YET (restaurant set-up,
 * "new outlet").
 *
 * The upload cannot happen here: the backend mints the presigned URL under the outlet's
 * id, so there is nothing to sign against until the outlet is created. So the pick is
 * held locally — shown from the phone's own file — and handed to the caller, which
 * uploads both right after creating the outlet (see useCreateStoreWithImages).
 */
export function StorefrontDraftPicker({
  value, onChange,
}: {
  value: StorefrontDraft;
  onChange: (next: StorefrontDraft) => void;
}) {
  const [busy, setBusy] = useState<FacadeKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (kind: FacadeKind) => {
    if (busy) return;
    setError(null);
    setBusy(kind);
    try {
      const file = await pickStoreImage(kind);
      if (file) onChange({ ...value, [kind]: file });
    } catch (e) {
      setError(e instanceof StoreImageError ? e.message : 'Couldn’t choose that picture. Try another one.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <StorefrontFacade
      bannerUri={value.banner?.uri}
      logoUri={value.logo?.uri}
      busy={busy}
      error={error}
      onPressKind={pick}
    />
  );
}

const LOGO = 72;

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs, marginBottom: Spacing.sm },
  banner: {
    height: 140, borderRadius: Radius.lg, overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  bannerImg: { width: '100%', height: '100%' },
  bannerEmpty: { alignItems: 'center', gap: 4 },
  emptyText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  badge: {
    position: 'absolute', right: Spacing.sm, bottom: Spacing.sm,
    width: 28, height: 28, borderRadius: Radius.full, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  // The logo sits on the banner's lower-left corner, overlapping it.
  logo: {
    position: 'absolute', left: Spacing.md, bottom: -LOGO / 3,
    width: LOGO, height: LOGO, borderRadius: Radius.full, overflow: 'visible',
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 3, borderColor: Colors.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
  },
  logoImg: { width: LOGO - 6, height: LOGO - 6, borderRadius: Radius.full },
  logoBadge: { right: -2, bottom: -2, width: 24, height: 24 },
  hint: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: LOGO / 3 + 2 },
  error: { color: Colors.error, fontSize: 13 },
});
