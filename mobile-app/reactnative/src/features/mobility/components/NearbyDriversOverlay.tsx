import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native';
import { CarFront } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

// Transform animations can use the native driver on device; react-native-web
// runs them on the JS thread, so disable the native driver there to avoid warns.
const NATIVE = Platform.OS !== 'web';

type Size = { w: number; h: number };

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A single car that continuously drifts between random waypoints, turning to
 *  face its direction of travel — the "nearby drivers moving" feel from
 *  Uber/Bolt/inDrive. Purely decorative; no real GPS. */
function Car({ size, delay }: { size: Size; delay: number }) {
  const pad = 22;
  const first = { x: rand(pad, size.w - pad), y: rand(pad, size.h - pad) };
  const pos = useRef(new Animated.ValueXY(first)).current;
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const n = 5;
    const wp = Array.from({ length: n }, () => ({ x: rand(pad, size.w - pad), y: rand(pad, size.h - pad) }));
    pos.setValue(wp[0]);

    const legs: Animated.CompositeAnimation[] = [];
    for (let i = 0; i < wp.length; i++) {
      const from = wp[i];
      const to = wp[(i + 1) % wp.length];
      const heading = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const duration = Math.max(2400, dist * 20 + rand(0, 1400));
      // Turn to face the next leg, then drive to it.
      legs.push(Animated.timing(rot, { toValue: heading, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE }));
      legs.push(Animated.timing(pos, { toValue: to, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE }));
    }

    const loop = Animated.loop(Animated.sequence(legs));
    const start = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(start); loop.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const rotate = rot.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] });

  return (
    <Animated.View style={[styles.car, { transform: [...pos.getTranslateTransform(), { rotate }] }]}>
      <View style={styles.carPin}>
        <CarFront size={15} color={Colors.onPrimary} strokeWidth={2.3} />
      </View>
    </Animated.View>
  );
}

/** Overlay of drifting cars, sized to its parent. Drop it over a map (with
 *  pointerEvents none so the map stays interactive). */
export default function NearbyDriversOverlay({ count = 5 }: { count?: number }) {
  const [size, setSize] = useState<Size | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (!size || size.w !== width || size.h !== height)) {
      setSize({ w: width, h: height });
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {size &&
        Array.from({ length: count }).map((_, i) => (
          <Car key={i} size={size} delay={i * 350} />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  car: { position: 'absolute', top: 0, left: 0, width: 26, height: 26, marginLeft: -13, marginTop: -13, alignItems: 'center', justifyContent: 'center' },
  carPin: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.white,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
});
