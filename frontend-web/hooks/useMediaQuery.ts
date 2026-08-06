'use client';

import { useEffect, useState } from 'react';

/**
 * Hook to detect media query matches
 * Returns true if the media query matches, false otherwise
 *
 * Usage:
 * const isMobile = useMediaQuery('(max-width: 767px)');
 * const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1024px)');
 * const isDark = useMediaQuery('(prefers-color-scheme: dark)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const mediaQueryList = window.matchMedia(query);

    // Set initial value
    setMatches(mediaQueryList.matches);

    // Create listener
    const listener = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };

    // Add listener (modern way)
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener('change', listener);
    } else {
      // Fallback for older browsers
      mediaQueryList.addListener(listener);
    }

    // Cleanup
    return () => {
      if (mediaQueryList.removeEventListener) {
        mediaQueryList.removeEventListener('change', listener);
      } else {
        mediaQueryList.removeListener(listener);
      }
    };
  }, [query]);

  // Prevent hydration mismatch by returning false until mounted
  return isMounted && matches;
}

/**
 * Hook to detect viewport size
 */
export function useViewport() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1024px)');
  const isDesktop = useMediaQuery('(min-width: 1025px)');
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const isPortrait = useMediaQuery('(orientation: portrait)');

  return {
    isMobile,
    isTablet,
    isDesktop,
    isLandscape,
    isPortrait,
    // Derived
    isMobileOrTablet: isMobile || isTablet,
  };
}

/**
 * Hook to detect if device prefers reduced motion
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Hook to detect dark mode preference
 */
export function usePrefersDarkMode(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}

/**
 * Hook to detect if device has touch capability
 */
export function useTouchCapable(): boolean {
  const [canTouch, setCanTouch] = useState(false);

  useEffect(() => {
    setCanTouch(
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      (navigator as any).msMaxTouchPoints > 0
    );
  }, []);

  return canTouch;
}

/**
 * Hook to get device orientation
 */
export function useOrientation() {
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const isPortrait = useMediaQuery('(orientation: portrait)');

  return {
    isLandscape,
    isPortrait,
    orientation: isLandscape ? 'landscape' : 'portrait',
  };
}
