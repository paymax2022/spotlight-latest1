import type { VehicleClass } from '../types/modes.types';

/** One amenity shown as an icon chip. `icon` is a lucide-react-native name,
 *  resolved dynamically in VehicleClassCard (with a safe fallback). */
export interface Amenity {
  icon: string;
  label: string;
}

export interface VehicleClassMeta {
  /** Example vehicles in this class. */
  model: string;
  seats: number;
  bags: number;
  /** Indicative rating / social proof (display only). */
  rating: number;
  trips: string;
  /** Indicative "from" hourly rate in kobo — mirrors the server/mock pricing
   *  (CLASS_HOURLY in carhire.mock.ts). The authoritative price still comes from
   *  the live quote shown in the fare breakdown + footer. */
  fromHourlyKobo: number;
  /** lucide-react-native icon name for the vehicle glyph. */
  icon: string;
  /** Hero gradient [top-left, bottom-right] + accent used for the price tag. */
  gradient: [string, string];
  accent: string;
  amenities: Amenity[];
}

export const VEHICLE_CLASS_META: Record<VehicleClass, VehicleClassMeta> = {
  economy: {
    model: 'Toyota Corolla / Camry',
    seats: 4, bags: 2, rating: 4.7, trips: '3.4k+ hires',
    fromHourlyKobo: 6_000_00, icon: 'Car',
    gradient: ['#0F766E', '#115E59'], accent: '#5EEAD4',
    amenities: [
      { icon: 'Snowflake', label: 'Air conditioning' },
      { icon: 'Usb', label: 'USB charging' },
      { icon: 'Bluetooth', label: 'Bluetooth audio' },
      { icon: 'ShieldCheck', label: 'Fully insured' },
    ],
  },
  executive: {
    model: 'Honda Accord / Mercedes E-Class',
    seats: 4, bags: 3, rating: 4.9, trips: '2.1k+ hires',
    fromHourlyKobo: 12_000_00, icon: 'CarFront',
    gradient: ['#3730A3', '#1E1B4B'], accent: '#A5B4FC',
    amenities: [
      { icon: 'Armchair', label: 'Leather seats' },
      { icon: 'Snowflake', label: 'Climate control' },
      { icon: 'Usb', label: 'USB-C charging' },
      { icon: 'GlassWater', label: 'Bottled water' },
      { icon: 'Bluetooth', label: 'Premium audio' },
    ],
  },
  suv: {
    model: 'Toyota Prado / Highlander',
    seats: 7, bags: 4, rating: 4.8, trips: '1.8k+ hires',
    fromHourlyKobo: 15_000_00, icon: 'Truck',
    gradient: ['#334155', '#0F172A'], accent: '#94A3B8',
    amenities: [
      { icon: 'Mountain', label: '4x4 capable' },
      { icon: 'Armchair', label: 'Leather interior' },
      { icon: 'Snowflake', label: 'Dual-zone AC' },
      { icon: 'Users', label: 'Seats up to 7' },
      { icon: 'GlassWater', label: 'Bottled water' },
    ],
  },
  luxury: {
    model: 'Mercedes S-Class / Range Rover',
    seats: 4, bags: 3, rating: 5.0, trips: '420+ hires',
    fromHourlyKobo: 35_000_00, icon: 'CarFront',
    gradient: ['#3F2D1A', '#1C1917'], accent: '#E8C983',
    amenities: [
      { icon: 'Armchair', label: 'Premium leather' },
      { icon: 'Lightbulb', label: 'Ambient lighting' },
      { icon: 'Wifi', label: 'Onboard Wi-Fi' },
      { icon: 'GlassWater', label: 'Refreshments' },
      { icon: 'ShieldCheck', label: 'Privacy glass' },
      { icon: 'Sparkles', label: 'Concierge service' },
    ],
  },
  van: {
    model: 'Toyota Sienna / Hiace',
    seats: 8, bags: 6, rating: 4.6, trips: '1.2k+ hires',
    fromHourlyKobo: 14_000_00, icon: 'BusFront',
    gradient: ['#0E7490', '#155E75'], accent: '#67E8F9',
    amenities: [
      { icon: 'Snowflake', label: 'Air conditioning' },
      { icon: 'Luggage', label: 'Extra luggage' },
      { icon: 'Usb', label: 'USB charging' },
      { icon: 'Users', label: 'Group seating' },
      { icon: 'Bluetooth', label: 'Bluetooth audio' },
    ],
  },
};

// ─── Gallery media ────────────────────────────────────────────────────────────
export interface GalleryMedia {
  type: 'image' | 'video';
  url: string;
  poster?: string; // video thumbnail
  label?: string;
}

// Sample/stock media so the exposition gallery is fully functional in dev.
// Replace with real per-vehicle uploaded photos/videos from the media API when
// available (e.g. GET /mobility/carhire/vehicles/:id/media).
const car = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1080&q=72`;
const VIDEO_JOY = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4';
const VIDEO_BLAZE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

export const VEHICLE_CLASS_GALLERY: Record<VehicleClass, GalleryMedia[]> = {
  economy: [
    { type: 'image', url: car('1541443131876-44b03de101c5'), label: 'Exterior' },
    { type: 'image', url: car('1517672651691-24622a91b550'), label: 'Front' },
    { type: 'image', url: car('1503736334956-4c8f8e92946d'), label: 'Interior' },
    { type: 'image', url: car('1494905998402-395d579af36f'), label: 'Rear' },
    { type: 'video', url: VIDEO_JOY, poster: car('1517672651691-24622a91b550'), label: 'Walkaround' },
  ],
  executive: [
    { type: 'image', url: car('1550355291-bbee04a92027'), label: 'Exterior' },
    { type: 'image', url: car('1503376780353-7e6692767b70'), label: 'Profile' },
    { type: 'image', url: car('1605559424843-9e4c228bf1c2'), label: 'Cabin' },
    { type: 'image', url: car('1493238792000-8113da705763'), label: 'Dashboard' },
    { type: 'image', url: car('1552519507-da3b142c6e3d'), label: 'Detail' },
    { type: 'video', url: VIDEO_BLAZE, poster: car('1550355291-bbee04a92027'), label: 'Walkaround' },
  ],
  suv: [
    { type: 'image', url: car('1519641471654-76ce0107ad1b'), label: 'Exterior' },
    { type: 'image', url: car('1494905998402-395d579af36f'), label: 'Off-road' },
    { type: 'image', url: car('1605559424843-9e4c228bf1c2'), label: 'Interior' },
    { type: 'image', url: car('1503736334956-4c8f8e92946d'), label: 'Seats' },
    { type: 'video', url: VIDEO_JOY, poster: car('1519641471654-76ce0107ad1b'), label: 'Walkaround' },
  ],
  luxury: [
    { type: 'image', url: car('1553440569-bcc63803a83d'), label: 'Exterior' },
    { type: 'image', url: car('1583121274602-3e2820c69888'), label: 'Profile' },
    { type: 'image', url: car('1605559424843-9e4c228bf1c2'), label: 'Premium cabin' },
    { type: 'image', url: car('1503736334956-4c8f8e92946d'), label: 'Detailing' },
    { type: 'image', url: car('1503376780353-7e6692767b70'), label: 'Front' },
    { type: 'video', url: VIDEO_BLAZE, poster: car('1583121274602-3e2820c69888'), label: 'Walkaround' },
  ],
  van: [
    { type: 'image', url: car('1618333452741-1c3b6ce6b6a4'), label: 'Exterior' },
    { type: 'image', url: car('1494905998402-395d579af36f'), label: 'Side' },
    { type: 'image', url: car('1503736334956-4c8f8e92946d'), label: 'Seating' },
    { type: 'video', url: VIDEO_JOY, poster: car('1494905998402-395d579af36f'), label: 'Walkaround' },
  ],
};

