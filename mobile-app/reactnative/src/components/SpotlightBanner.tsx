// ── SpotlightBanner ───────────────────────────────────────────────────────────
// Reusable, responsive, Cloudinary-backed marketing banner. The one component
// every screen with a promo/hero banner should render through, so the rules
// below live in exactly one place instead of being re-solved per screen:
//
//  • Responsive width — requests the bucketed width for the CURRENT viewport
//    (see src/lib/cloudinary.ts), never a fixed size like 900px for everyone.
//    Re-evaluates on rotation / window resize.
//  • Priority vs lazy — pass `priority` on the ONE banner that's visible the
//    instant its screen/section opens; it loads immediately at high request
//    priority. Leave every other instance (e.g. later cards in a carousel)
//    at the default — expo-image schedules those at low priority, and inside
//    a virtualized list (FlatList/FlashList) they don't even mount, let alone
//    fetch, until they're about to scroll into view. RN has no real
//    IntersectionObserver equivalent outside virtualization, so "lazy" here
//    means: don't compete with the priority banner, and rely on the list to
//    not mount what isn't visible.
//  • Placeholder — a tiny, heavily-blurred Cloudinary variant of the SAME
//    asset shows immediately and cross-fades into the full image once it
//    decodes, so there's never a blank flash.
//  • Caching — expo-image persists decoded bytes to disk; Cloudinary already
//    serves long-lived, immutable responses for a given public ID. A
//    returning user pays the download cost once.
//
// Images are NEVER bundled into the app binary. The backend hands the client
// a Cloudinary public ID (see src/features/media/banners), and the actual
// pixels are always fetched from the CDN at render time — a redesigned
// banner ships by pointing the backend at a new public ID, no app release.
import React from 'react';
import { StyleSheet, Pressable, type StyleProp, type ImageStyle } from 'react-native';
import { Image } from 'expo-image';
import { Radius } from '@/constants/radius';
import { Colors } from '@/constants/colors';
import { cloudinaryBannerUrl, cloudinaryBannerPlaceholderUrl, useBannerWidth } from '@/lib/cloudinary';

interface Props {
  /** Full Cloudinary public ID, folder included, e.g. "SPOTLIGHT/Banners/banner-connect_epyebw". */
  publicId: string;
  /**
   * True for the banner visible the instant its screen/section opens — skips
   * the lazy default and requests at high priority. Every OTHER banner
   * rendered at the same time (e.g. offscreen carousel items that ARE
   * mounted) should leave this false so it never contends with the one the
   * user is actually looking at.
   */
  priority?: boolean;
  /** width / height, e.g. 8/3 for a typical wide hero. Reserves layout space before the image decodes. */
  aspectRatio?: number;
  alt?: string;
  onPress?: () => void;
  style?: StyleProp<ImageStyle>;
}

export default function SpotlightBanner({
  publicId,
  priority = false,
  aspectRatio = 8 / 3,
  alt,
  onPress,
  style,
}: Props) {
  const width = useBannerWidth();
  const uri = cloudinaryBannerUrl(publicId, width);
  const placeholderUri = cloudinaryBannerPlaceholderUrl(publicId);

  const body = (
    <Image
      source={{ uri }}
      placeholder={{ uri: placeholderUri }}
      placeholderContentFit="cover"
      transition={200}
      style={[styles.image, { aspectRatio }, style]}
      contentFit="cover"
      cachePolicy="disk"
      priority={priority ? 'high' : 'low'}
      accessible
      accessibilityRole="image"
      accessibilityLabel={alt}
    />
  );

  if (!onPress) return body;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={alt}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow,
  },
});
