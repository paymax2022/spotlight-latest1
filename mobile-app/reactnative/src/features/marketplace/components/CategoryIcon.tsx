// ── Category icon: a dimensional puck, one identity per category ─────────────
//
// The grid used to render every category as the SAME flat lucide `Package` in a
// single lilac square. That was not a styling preference — mkt_categories has no
// icon column, so `category.icon` is undefined for every API row and the tile's
// `?? 'Package'` fallback caught all of them. Nineteen identical tiles, so the
// only thing distinguishing "Cars" from "Property" was two lines of small text.
//
// Two things are being fixed, and the first matters more than the styling: each
// category gets its OWN glyph and its OWN hue, so the grid is scannable by shape
// and colour before a word is read. Icon and colour move together — hue is a
// second channel carrying the same identity, not decoration.
//
// The 3D read comes from modelling one light source, top-left, consistently:
//   · a diagonal gradient, lighter at the top-left corner, deeper at the
//     bottom-right, so the face is lit rather than filled;
//   · a specular sheen over the upper half, fading out before the middle;
//   · a hairline top edge in translucent white — the lit rim of a raised surface;
//   · a drop shadow tinted with the CATEGORY's own hue rather than black, which
//     is what stops nineteen coloured pucks reading as stickers on grey card.
// The glyph sits white on saturated colour, so contrast holds in both themes.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import { Radius } from '@/constants/radius';

type Spec = { icon: string; from: string; to: string };

// Hue is assigned by MEANING first — vehicles blue, living/property teal,
// people-and-work green, craft and materials warm — then adjusted so that no two
// tiles ADJACENT in the 4-up grid share a hue family, which is the property that
// actually makes the grid scannable.
//
// That adjustment is not theoretical: health-beauty and babies-kids were both
// pink, and with fashion between them the middle row rendered as three pinks in a
// row. Health took coral (warm, still reads clinical//spa) and babies took
// periwinkle, which also separates them from their vertical neighbours.
const SPECS: Record<string, Spec> = {
  // The twelve mains the live taxonomy actually serves, keyed on their real
  // slugs (GET /categories). `vehicles`, `leisure-hobbies` and `jobs-services`
  // were the three that fell through to the grey fallback when this map was
  // written against the older category names.
  vehicles:                { icon: 'Car',        from: '#4DA3FF', to: '#1462C4' },
  'leisure-hobbies':       { icon: 'Gamepad2',   from: '#C084FC', to: '#7E22CE' },
  'jobs-services':         { icon: 'Briefcase',  from: '#34D399', to: '#047857' },
  'phones-tablets':        { icon: 'Smartphone', from: '#7C5CFF', to: '#4B2FD6' },
  'computers-laptops':     { icon: 'Laptop',     from: '#5B8DEF', to: '#2B5FD9' },
  electronics:             { icon: 'Cpu',        from: '#22B8CF', to: '#0B7285' },
  cars:                    { icon: 'Car',        from: '#4DA3FF', to: '#1462C4' },
  'motorcycles-scooters':  { icon: 'Bike',       from: '#FF9F45', to: '#E2620B' },
  property:                { icon: 'Building2',  from: '#2DD4A7', to: '#0E8F70' },
  'home-furniture':        { icon: 'Sofa',       from: '#F0B429', to: '#B7791F' },
  fashion:                 { icon: 'Shirt',      from: '#FF7AB6', to: '#D6246E' },
  'health-beauty':         { icon: 'Sparkles',   from: '#FB923C', to: '#C2410C' },
  services:                { icon: 'Wrench',     from: '#A78BFA', to: '#6D28D9' },
  jobs:                    { icon: 'Briefcase',  from: '#34D399', to: '#047857' },
  'babies-kids':           { icon: 'Baby',       from: '#93C5FD', to: '#2563EB' },
  'sports-fitness':        { icon: 'Dumbbell',   from: '#A3E635', to: '#4D7C0F' },
  'agriculture-food':      { icon: 'Wheat',      from: '#7BC96F', to: '#2F7D32' },
  'animals-pets':          { icon: 'PawPrint',   from: '#D9A066', to: '#8B5A2B' },
  'books-games':           { icon: 'BookOpen',   from: '#8B7CFF', to: '#4C1D95' },
  'commercial-equipment':  { icon: 'Factory',    from: '#8FA3B8', to: '#455A76' },
  'repair-construction':   { icon: 'Hammer',     from: '#FF8A5B', to: '#C2410C' },
  'musical-instruments':   { icon: 'Music',      from: '#E879F9', to: '#A21CAF' },
};

// Name matching is the fallback for rows whose slug is generated rather than
// curated (the seeded test categories carry slugs like `test-cat-9f3a…`), so a
// sensibly NAMED category still resolves even when its slug says nothing.
const BY_NAME: Record<string, string> = {
  'phones & tablets': 'phones-tablets', phones: 'phones-tablets', mobile: 'phones-tablets',
  'computers & laptops': 'computers-laptops', computers: 'computers-laptops', laptops: 'computers-laptops',
  electronics: 'electronics', cars: 'cars', vehicles: 'cars', property: 'property',
  'real estate': 'property', 'home & furniture': 'home-furniture', furniture: 'home-furniture',
  fashion: 'fashion', clothing: 'fashion', 'health & beauty': 'health-beauty', beauty: 'health-beauty',
  services: 'services', jobs: 'jobs', 'babies & kids': 'babies-kids', 'sports & fitness': 'sports-fitness',
  'agriculture & food': 'agriculture-food', food: 'agriculture-food', 'animals & pets': 'animals-pets',
  pets: 'animals-pets', 'books & games': 'books-games', 'commercial equipment': 'commercial-equipment',
  'repair & construction': 'repair-construction', 'musical instruments': 'musical-instruments',
  'motorcycles & scooters': 'motorcycles-scooters',
};

// Anything unrecognised still gets a real puck rather than a grey box — an
// unmapped category should look deliberate, not broken.
const FALLBACK: Spec = { icon: 'Package', from: '#9CA3AF', to: '#4B5563' };

type CategoryLike = { slug?: string; name?: string; icon?: string };

export function specFor(category: CategoryLike, parent?: CategoryLike): Spec {
  const own = ownSpec(category);
  if (!parent) return own;
  // A child keeps its OWN glyph but always takes its parent's hue. Precedence
  // matters and is not obvious: several curated slugs (motorcycles-scooters,
  // cars, services…) are subcategories in the live taxonomy, so matching on slug
  // first put one orange puck among five blue Vehicles siblings and the family
  // stopped reading as a family. Whoever owns the hue owns the grouping, and one
  // level down the grouping is the parent's.
  //
  // A parent is never itself given a parent, so this recurses at most once.
  const hue = ownSpec(parent);
  return { icon: own.icon, from: hue.from, to: hue.to };
}

// The category's own identity, ignoring any parent: curated first, then the
// server's icon column, then the neutral fallback.
function ownSpec(category: CategoryLike): Spec {
  const slug = (category.slug ?? '').toLowerCase();
  if (SPECS[slug]) return SPECS[slug];
  const key = BY_NAME[(category.name ?? '').trim().toLowerCase()];
  if (key && SPECS[key]) return SPECS[key];
  // mkt_categories carries a lucide name per category (migration 20270123000000);
  // it supplies the glyph for the 72 subcategories the curated map does not name.
  if (category.icon && (Icons as Record<string, unknown>)[category.icon]) {
    return { ...FALLBACK, icon: category.icon };
  }
  return FALLBACK;
}

export default function CategoryIcon({
  category,
  parent,
  size = 56,
}: {
  category: CategoryLike;
  /** The category this one sits under; supplies the hue for subcategories. */
  parent?: CategoryLike;
  size?: number;
}) {
  const spec = specFor(category, parent);
  const Glyph = ((Icons as unknown as Record<string, Icons.LucideIcon>)[spec.icon]
    ?? Icons.Package) as Icons.LucideIcon;

  return (
    <View
      style={[
        styles.shadow,
        // The shadow takes the puck's own colour. A black shadow under a
        // saturated face reads as dirt; a tinted one reads as depth.
        { width: size, height: size, borderRadius: Radius.lg, shadowColor: spec.to },
      ]}
    >
      <LinearGradient
        colors={[spec.from, spec.to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.face, { width: size, height: size, borderRadius: Radius.lg }]}
      >
        {/* Specular sheen: strongest at the very top, gone by the middle, so the
            face reads as curved rather than as a flat panel with a white band. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']}
          locations={[0, 0.45, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.75, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: Radius.lg }]}
        />
        <Glyph size={Math.round(size * 0.46)} color="#FFFFFF" strokeWidth={2.1} />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowOpacity: 0.38,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  face: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // The lit rim. Only the top edge is brightened, matching the light source
    // the gradient and sheen already agree on.
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: 'rgba(255,255,255,0.55)',
  },
});
