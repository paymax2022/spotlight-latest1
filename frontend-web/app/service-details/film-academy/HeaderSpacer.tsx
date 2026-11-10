'use client';

import { useEffect, useState } from 'react';

/**
 * main.css flips #header-sticky to position:fixed past 100px of scroll, which
 * takes it out of flow and pulls the whole page up by its own height. An anchor
 * jump aimed at a section then lands short by exactly that much, and the fixed
 * bar covers what is left of the gap. This spacer appears in the same render the
 * sticky class does, so the document height never changes mid-jump.
 */
export default function HeaderSpacer() {
  const [stuck, setStuck] = useState(false);
  const [gap, setGap] = useState(0);

  useEffect(() => {
    // Read the height only while the header still sits in flow: past the
    // threshold it is fixed, and its box is no longer the space to replace.
    const measure = () => {
      const header = document.getElementById('header-sticky');
      if (header && header.offsetHeight) setGap(header.offsetHeight);
    };

    const onScroll = () => {
      const next = window.scrollY > 100;
      setStuck((prev) => (prev === next ? prev : next));
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, []);

  if (!stuck) return null;
  return <div style={{ height: gap }} aria-hidden="true" />;
}
