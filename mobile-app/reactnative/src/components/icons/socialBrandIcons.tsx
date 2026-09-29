// lucide-react-native dropped every brand/social glyph (Facebook, Twitter,
// Linkedin, Instagram) a while back — trademark logos don't belong in a
// generic icon set. The exports simply stopped existing, which is why
// `import { Facebook, Twitter, Linkedin, Instagram } from 'lucide-react-native'`
// started failing typecheck with no code change on our side.
//
// These are the same stroke-style outline glyphs lucide (and Feather Icons,
// which lucide forked from) used to ship, kept locally so the share sheets
// don't need a pixel-exact brand logo — just a recognizable outline that
// matches the stroke style of the other lucide icons rendered alongside them.
// Same prop shape as lucide-react-native so this is a drop-in replacement.
import React from 'react';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';

export interface SocialIconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Facebook({ size = 24, color = '#000000', strokeWidth = 2 }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Twitter({ size = 24, color = '#000000', strokeWidth = 2 }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Linkedin({ size = 24, color = '#000000', strokeWidth = 2 }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x={2} y={9} width={4} height={12} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={4} cy={4} r={2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function Instagram({ size = 24, color = '#000000', strokeWidth = 2 }: SocialIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2} y={2} width={20} height={20} rx={5} ry={5} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1={17.5} y1={6.5} x2={17.5} y2={6.5} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
