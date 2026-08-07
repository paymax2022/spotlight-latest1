'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hook to detect long-press gesture
 * Triggers after specified duration
 *
 * Usage:
 * const ref = useRef(null);
 * useLongPress(ref, {
 *   onLongPress: () => showMenu(),
 *   duration: 500,
 * });
 *
 * return <div ref={ref}>Long press me</div>
 */
export function useLongPress(
  ref: React.RefObject<HTMLElement>,
  options: {
    onLongPress: () => void;
    duration?: number; // Default: 500ms
    onPressStart?: () => void;
    onPressEnd?: () => void;
  }
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const duration = options.duration || 500;

  useEffect(() => {
    if (!ref.current) return;

    const handleTouchStart = () => {
      setIsPressed(true);
      options.onPressStart?.();

      timeoutRef.current = setTimeout(() => {
        options.onLongPress();
        setIsPressed(false);
      }, duration);
    };

    const handleTouchEnd = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setIsPressed(false);
      options.onPressEnd?.();
    };

    const handleTouchCancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setIsPressed(false);
    };

    const element = ref.current;
    element.addEventListener('touchstart', handleTouchStart);
    element.addEventListener('touchend', handleTouchEnd);
    element.addEventListener('touchcancel', handleTouchCancel);

    // Also support mouse for desktop testing
    element.addEventListener('mousedown', handleTouchStart);
    element.addEventListener('mouseup', handleTouchEnd);
    element.addEventListener('mouseleave', handleTouchCancel);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', handleTouchCancel);
      element.removeEventListener('mousedown', handleTouchStart);
      element.removeEventListener('mouseup', handleTouchEnd);
      element.removeEventListener('mouseleave', handleTouchCancel);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [ref, duration, options]);

  return { isPressed };
}

/**
 * Hook to detect pinch-to-zoom gesture
 * Measures distance between two fingers
 *
 * Usage:
 * const ref = useRef(null);
 * const { scale, isZooming } = usePinchZoom(ref, {
 *   onZoom: (scale) => handleZoom(scale),
 *   maxScale: 3,
 * });
 *
 * return (
 *   <div ref={ref} style={{ transform: `scale(${scale})` }}>
 *     Pinch to zoom
 *   </div>
 * );
 */
export function usePinchZoom(
  ref: React.RefObject<HTMLElement>,
  options?: {
    onZoom?: (scale: number) => void;
    minScale?: number; // Default: 1
    maxScale?: number; // Default: 3
    onZoomStart?: () => void;
    onZoomEnd?: () => void;
  }
) {
  const [scale, setScale] = useState(1);
  const [isZooming, setIsZooming] = useState(false);
  const lastDistanceRef = useRef<number>(0);
  const minScale = options?.minScale || 1;
  const maxScale = options?.maxScale || 3;

  useEffect(() => {
    if (!ref.current) return;

    const getDistance = (touch1: Touch, touch2: Touch) => {
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        setIsZooming(true);
        options?.onZoomStart?.();
        lastDistanceRef.current = getDistance(e.touches[0], e.touches[1]);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastDistanceRef.current > 0) {
        e.preventDefault();

        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const pinchScale = currentDistance / lastDistanceRef.current;

        setScale((prev) => {
          const newScale = Math.max(minScale, Math.min(maxScale, prev * pinchScale));
          options?.onZoom?.(newScale);
          return newScale;
        });

        lastDistanceRef.current = currentDistance;
      }
    };

    const handleTouchEnd = () => {
      if (isZooming) {
        setIsZooming(false);
        options?.onZoomEnd?.();
      }
      lastDistanceRef.current = 0;
    };

    const element = ref.current;
    element.addEventListener('touchstart', handleTouchStart);
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref, options, isZooming]);

  const resetZoom = () => {
    setScale(1);
  };

  return { scale, isZooming, resetZoom };
}

/**
 * Hook to detect two-finger tap (double-tap with two fingers)
 * Useful for showing answer hints or solutions
 *
 * Usage:
 * const ref = useRef(null);
 * useTwoFingerTap(ref, {
 *   onTap: () => showHint(),
 * });
 */
export function useTwoFingerTap(
  ref: React.RefObject<HTMLElement>,
  options: {
    onTap: () => void;
    maxDelay?: number; // Default: 200ms between touches
  }
) {
  const firstTouchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const maxDelay = options.maxDelay || 200;

  useEffect(() => {
    if (!ref.current) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const touch1 = e.touches[0];
        const currentTime = Date.now();

        if (firstTouchRef.current) {
          const timeDiff = currentTime - firstTouchRef.current.time;
          const distX = Math.abs(touch1.clientX - firstTouchRef.current.x);
          const distY = Math.abs(touch1.clientY - firstTouchRef.current.y);

          // Check if second tap is close in time and space
          if (timeDiff < maxDelay && distX < 100 && distY < 100) {
            options.onTap();
            firstTouchRef.current = null;
            return;
          }
        }

        firstTouchRef.current = {
          x: touch1.clientX,
          y: touch1.clientY,
          time: currentTime,
        };
      }
    };

    const element = ref.current;
    element.addEventListener('touchstart', handleTouchStart);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
    };
  }, [ref, options]);

  return { isDetecting };
}

/**
 * Hook for rotating content with two-finger rotation
 *
 * Usage:
 * const { rotation } = useTwoFingerRotate(ref);
 * return <div ref={ref} style={{ transform: `rotate(${rotation}deg)` }} />
 */
export function useTwoFingerRotate(
  ref: React.RefObject<HTMLElement>,
  options?: {
    onRotate?: (angle: number) => void;
    onRotationEnd?: () => void;
  }
) {
  const [rotation, setRotation] = useState(0);
  const lastAngleRef = useRef<number>(0);

  useEffect(() => {
    if (!ref.current) return;

    const getAngle = (touch1: Touch, touch2: Touch) => {
      const dx = touch2.clientX - touch1.clientX;
      const dy = touch2.clientY - touch1.clientY;
      return (Math.atan2(dy, dx) * 180) / Math.PI;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastAngleRef.current = getAngle(e.touches[0], e.touches[1]);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();

        const currentAngle = getAngle(e.touches[0], e.touches[1]);
        const angleDiff = currentAngle - lastAngleRef.current;

        setRotation((prev) => {
          const newRotation = (prev + angleDiff) % 360;
          options?.onRotate?.(newRotation);
          return newRotation;
        });

        lastAngleRef.current = currentAngle;
      }
    };

    const handleTouchEnd = () => {
      if (rotation !== 0) {
        options?.onRotationEnd?.();
      }
    };

    const element = ref.current;
    element.addEventListener('touchstart', handleTouchStart);
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref, options, rotation]);

  const resetRotation = () => {
    setRotation(0);
  };

  return { rotation, resetRotation };
}

/**
 * Hook for multi-touch pressure detection
 * Some devices support pressure/force on touch
 *
 * Returns pressure value (0-1) if supported
 */
export function useTouchPressure(ref: React.RefObject<HTMLElement>) {
  const [pressure, setPressure] = useState(0);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Check if force is available
      if (e.touches[0].force !== undefined) {
        setIsSupported(true);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0].force !== undefined) {
        // Normalize to 0-1 range
        setPressure(e.touches[0].force);
      }
    };

    const handleTouchEnd = () => {
      setPressure(0);
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

  return { pressure, isSupported };
}
