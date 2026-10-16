import React, { useState } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Camera, Store } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { useUpdateStore } from './hooks';
import { StoreImageUploadsUnavailableError } from './api';
import { pickStoreImage, uploadStoreImage, StoreImageError } from './storeImageUpload';
import type { StoreImageKind } from './storeImages';

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
  const [busy, setBusy] = useState<StoreImageKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState<Record<StoreImageKind, boolean>>({ logo: false, banner: false });

  const change = async (kind: StoreImageKind) => {
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

  const showBanner = !!bannerUrl && !broken.banner;
  const showLogo = !!logoUrl && !broken.logo;

  return (
    <View style={styles.wrap}>
      <View>
        <Pressable
          onPress={() => change('banner')}
          style={styles.banner}
          accessibilityRole="button"
          accessibilityLabel={showBanner ? 'Change banner picture' : 'Add a banner picture'}
        >
          {showBanner ? (
            <Image
              source={{ uri: bannerUrl! }}
              style={styles.bannerImg}
              resizeMode="cover"
              onError={() => setBroken((b) => ({ ...b, banner: true }))}
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
          onPress={() => change('logo')}
          style={styles.logo}
          accessibilityRole="button"
          accessibilityLabel={showLogo ? 'Change logo' : 'Add a logo'}
        >
          {showLogo ? (
            <Image
              source={{ uri: logoUrl! }}
              style={styles.logoImg}
              resizeMode="cover"
              onError={() => setBroken((b) => ({ ...b, logo: true }))}
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
