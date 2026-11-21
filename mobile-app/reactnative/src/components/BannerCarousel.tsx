import React, { useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, View, useWindowDimensions,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import SpotlightBanner from '@/components/SpotlightBanner';
import CarouselDots from '@/features/doctor/components/CarouselDots';
import { Radius, Spacing } from '@/constants/tokens';

export interface BannerSlide {
  /** Stable id: the React key, and the handle a test or analytics hook uses. */
  id:       string;
  /** Cloudinary public ID, exactly as the CDN stores it (no folder, no extension). */
  publicId: string;
  /** The artwork's own promise in one line — the accessible name of the tap. */
  alt:      string;
  /** Where the tap goes. The caller decides, so the slide stays presentational. */
  onPress:  () => void;
}

interface Props {
  banners: BannerSlide[];
}

// Every banner in this family is 1774x887. Reserving that ratio per page shows
// the whole artwork — nothing a headline says gets cropped out of the frame —
// and keeps the row from jumping as pages decode. Same reasoning as the
// education hub's hero, which calls out the ratio for the identical asset size.
const BANNER_ASPECT_RATIO = 1774 / 887;

// How long a campaign gets on screen before the row pages itself. Four seconds
// is long enough to read a headline and its CTA — these artworks carry both —
// and short enough that the strip does not feel stuck on the first offer.
const AUTO_ADVANCE_MS = 4_000;

/**
 * One-screen-per-banner promotional pager: it moves through the campaigns on
 * its own, the user can swipe or drag between them, and tapping one goes to the
 * service it shows. Dots under the row show where you are. The slides are given
 * to it already filtered, so the screen that owns the registry gate stays
 * responsible for what is publishable and this component stays a control.
 */
export default function BannerCarousel({ banners }: Props) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  // Held means "a person is engaged with this row right now": a finger down on
  // a slide, a drag in progress, or a cursor resting on it. While it is held the
  // clock stops, because a panel that moves under a finger that is aiming at a
  // banner is how a user ends up somewhere they did not choose.
  const [held, setHeld] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // A registry answer can shrink the list under the current page (unpublish a
  // module while its banner is on screen), so the highlighted dot follows the
  // list rather than a stale index.
  const last = Math.max(0, banners.length - 1);
  const active = Math.min(index, last);

  const goToPage = (page: number) => {
    const next = Math.min(Math.max(page, 0), last);
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, y: 0, animated: true });
  };

  // react-native-web drops onMomentumScrollEnd, so a swipe would move the page
  // without moving the dots. Read the offset from onScroll as well, but only
  // commit once it settles on a page boundary — the guard the intro pager uses
  // for the same reason.
  const commitOffset = (offsetX: number) => {
    const page = offsetX / Math.max(1, width);
    const next = Math.round(page);
    if (Math.abs(page - next) > 0.02 || next < 0 || next > last) return;
    if (next !== index) setIndex(next);
  };
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    commitOffset(e.nativeEvent.contentOffset.x);

  // Nothing published, nothing to show — no empty tinted frame where a carousel
  // used to be.
  const show = banners.length > 0;

  // The clock. It is re-armed on every page change, so a manual swipe gets its
  // own full four seconds before the row moves again rather than being cut off
  // mid-read, and a single-slide row never arms a timer that would do nothing.
  React.useEffect(() => {
    if (!show || held || banners.length < 2) return;
    const id = setInterval(() => goToPage((active + 1) % banners.length), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
    // goToPage is recreated each render on purpose: the effect must re-run when
    // `active` changes so the interval restarts from the new page.
  }, [show, held, active, banners.length, width]);

  if (!show) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        // A drag in progress is a person steering, so the clock waits until the
        // row settles.
        onScrollBeginDrag={() => setHeld(true)}
        onScrollEndDrag={() => setHeld(false)}
        // The scroll container, not a slide: the landing suite asserts this
        // element snaps (see landing-banners.spec.ts). A testID is the only
        // stable way to name the container itself — the slides are already
        // findable by their accessible names.
        testID="landing-banner-pager"
      >
        {banners.map((banner, i) => (
          <View key={banner.id} style={[styles.page, { width }]}>
            <Pressable
              onPress={banner.onPress}
              accessibilityRole="button"
              accessibilityLabel={banner.alt}
              // Finger down holds the row: the four-second clock must never move
              // the banner a user is aiming at. Hover is the same promise for a
              // mouse, and is simply never signalled on a touch screen.
              onPressIn={() => setHeld(true)}
              onPressOut={() => setHeld(false)}
              onHoverIn={() => setHeld(true)}
              onHoverOut={() => setHeld(false)}
              style={({ pressed }) => [styles.slide, pressed && styles.pressed]}
            >
              {/* Only the first page is a priority fetch; the rest are mounted
                  offscreen and must not contend for bandwidth with the banner
                  the user is actually looking at. */}
              <SpotlightBanner
                publicId={banner.publicId}
                alt={banner.alt}
                aspectRatio={BANNER_ASPECT_RATIO}
                priority={i === 0}
              />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      {banners.length > 1 ? (
        <View style={styles.dots}>
          <CarouselDots count={banners.length} active={active} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:    { marginTop: Spacing.lg },
  // The page is a full viewport wide so pagingEnabled snaps edge to edge; the
  // gutter lives inside it, which is what keeps the banner off the screen edges
  // without making the snap points drift.
  page:    { paddingHorizontal: Spacing.containerMargin },
  slide:   { borderRadius: Radius.xl, overflow: 'hidden' },
  pressed: { opacity: 0.92 },
  dots:    { marginTop: Spacing.sm },
});
