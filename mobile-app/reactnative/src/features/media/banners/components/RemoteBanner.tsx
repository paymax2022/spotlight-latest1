// ── Paymax Media — RemoteBanner ──────────────────────────────────────────────
// Resolves a marketing banner by slug (see ../hooks, ../api) and renders it.
// The resolver hands back either a Cloudinary public ID (preferred — rendered
// through the reusable SpotlightBanner, which picks a responsive width, shows
// a blurred placeholder, and caches to disk) or, for older banners not yet
// migrated, a presigned Cloudflare R2 URL (rendered with a plain Image).
//
// Behaviour is deliberately quiet: the banner is decoration, so while it loads
// the component reserves its exact aspect ratio (no layout shift when the image
// pops in), and if the resolver or the image fails it renders NOTHING rather
// than an error card. A screen must never look broken because a picture didn't
// arrive.

import React, { useState } from 'react';
import { View, Image, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import SpotlightBanner from '@/components/SpotlightBanner';
import { useBanner } from '../hooks';

type Props = {
  /** Banner slug registered in the gateway resolver, e.g. 'health-vet'. */
  slug: string;
  /** Optional tap target (e.g. the banner's call to action). */
  onPress?: () => void;
  /** Override the alt text the server ships with the artwork. */
  accessibilityLabel?: string;
  /** True for the banner visible the instant its screen/section opens — see SpotlightBanner. */
  priority?: boolean;
  style?: object;
};

export default function RemoteBanner({ slug, onPress, accessibilityLabel, priority, style }: Props) {
  const { data, isLoading, isError } = useBanner(slug);
  const [imageFailed, setImageFailed] = useState(false);

  if (isError || imageFailed) return null;

  // Fall back to the 8:3 artwork ratio while the descriptor is in flight so the
  // placeholder occupies exactly the space the image will.
  const aspectRatio = data?.aspectRatio ?? 8 / 3;

  if (data?.cloudinaryPublicId) {
    return (
      <SpotlightBanner
        publicId={data.cloudinaryPublicId}
        priority={priority}
        aspectRatio={aspectRatio}
        alt={accessibilityLabel ?? data.alt}
        onPress={onPress}
        style={style}
      />
    );
  }

  const body = (
    <View style={[styles.frame, { aspectRatio }, style]}>
      {data?.url ? (
        <Image
          source={{ uri: data.url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel ?? data.alt}
        />
      ) : isLoading ? (
        <ActivityIndicator color={Colors.primary} />
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? data?.alt}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
