'use client';

import { useEffect, useRef, useState } from 'react';

interface SwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number; // Minimum pixels to register swipe (default: 50)
  preventDefault?: boolean; // Prevent default behavior (default: true)
}

interface TouchCoordinates {
  x: number;
  y: number;
  timestamp: number;
}

/**
 * Hook to detect swipe gestures on touch devices
 *
 * Usage:
 * const ref = useRef(null);
 * useSwipeGesture(ref, {
 *   onSwipeLeft: () => nextQuestion(),
 *   onSwipeRight: () => previousQuestion(),
 * });
 *
 * return <div ref={ref}>Swipeable content</div>
 */
export function useSwipeGesture(
  ref: React.RefObject<HTMLElement>,
  options: SwipeGestureOptions
) {
  const touchStart = useRef<TouchCoordinates | null>(null);
  const touchEnd = useRef<TouchCoordinates | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  const threshold = options.threshold || 50;
  const preventDefault = options.preventDefault !== false;

  useEffect(() => {
    if (!ref.current) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return;

      const touch = e.touches[0];
      touchStart.current = {
        x: touch.clientX,
        y: touch.clientY,
        timestamp: Date.now(),
      };
      touchEnd.current = null;
      setIsDetecting(true);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0 || !touchStart.current) return;

      const touch = e.touches[0];
      touchEnd.current = {
        x: touch.clientX,
        y: touch.clientY,
        timestamp: Date.now(),
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current || !touchEnd.current) {
        setIsDetecting(false);
        return;
      }

      const deltaX = touchEnd.current.x - touchStart.current.x;
      const deltaY = touchEnd.current.y - touchStart.current.y;
      const deltaTime = touchEnd.current.timestamp - touchStart.current.timestamp;

      // Ignore if swipe is too slow (> 1 second)
      if (deltaTime > 1000) {
        setIsDetecting(false);
        return;
      }

      // Ignore if swipe is too small
      if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
        setIsDetecting(false);
        return;
      }

      // Determine swipe direction (X takes precedence if both > threshold)
      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

      if (isHorizontal) {
        if (deltaX > threshold && options.onSwipeRight) {
          if (preventDefault) {
            e.preventDefault();
          }
          options.onSwipeRight();
        } else if (deltaX < -threshold && options.onSwipeLeft) {
          if (preventDefault) {
            e.preventDefault();
          }
          options.onSwipeLeft();
        }
      } else {
        if (deltaY > threshold && options.onSwipeDown) {
          if (preventDefault) {
            e.preventDefault();
          }
          options.onSwipeDown();
        } else if (deltaY < -threshold && options.onSwipeUp) {
          if (preventDefault) {
            e.preventDefault();
          }
          options.onSwipeUp();
        }
      }

      setIsDetecting(false);
      touchStart.current = null;
      touchEnd.current = null;
    };

    const element = ref.current;
    element.addEventListener('touchstart', handleTouchStart, false);
    element.addEventListener('touchmove', handleTouchMove, false);
    element.addEventListener('touchend', handleTouchEnd, false);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref, threshold, preventDefault, options]);

  return { isDetecting };
}

/**
 * Hook to provide visual feedback during swipe gesture
 *
 * Returns X translation while swiping, for custom animations
 */
export function useSwipeFeedback(ref: React.RefObject<HTMLElement>) {
  const [translateX, setTranslateX] = useState(0);
  const touchStart = useRef<TouchCoordinates | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      touchStart.current = {
        x: touch.clientX,
        y: touch.clientY,
        timestamp: Date.now(),
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0 || !touchStart.current) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStart.current.x;

      // Only apply transform for horizontal swipes
      if (Math.abs(deltaX) > Math.abs(touch.clientY - touchStart.current.y)) {
        setTranslateX(deltaX * 0.3); // 30% of actual swipe for visual feedback
      }
    };

    const handleTouchEnd = () => {
      setTranslateX(0);
      touchStart.current = null;
    };

    const element = ref.current;
    element.addEventListener('touchstart', handleTouchStart);
    element.addEventListener('touchmove', handleTouchMove);
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref]);

  return translateX;
}
