// ── Paymax Stays — Mock supply ───────────────────────────────────────────────
// Realistic NG hotels (Lagos / Abuja, mixed star, NGN + a USD-priced upscale).
// Money is minor units: kobo for NGN, cents for USD. This module is the ONLY
// place mock fixtures live; the api layer maps everything to normalised models.

import type {
  AddOn,
  Deal,
  DestinationSuggestion,
  GuestProfile,
  PropertyCard,
  Review,
  RoomType,
} from '../types';

const IMG = {
  ekoHotel: 'https://images.unsplash.com/photo-1566073771259-6a8506099945',
  radisson: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791',
  transcorp: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb',
  apartment: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267',
  guesthouse: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d',
  resort: 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9',
  budget: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32',
  upscale: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39',
};

export const MOCK_PROPERTIES: PropertyCard[] = [
  {
    id: 'stay_lag_eko',
    name: 'Eko Signature, Victoria Island',
    city: 'Lagos',
    area: 'Victoria Island',
    star: 5,
    propertyType: 'hotel',
    sourceRail: 'DIRECT',
    coverUrl: IMG.ekoHotel,
    leadPriceMinor: 9_850_000, // ₦98,500/night
    currency: 'NGN',
    wasPriceMinor: 12_000_000,
    reviewScore: 9.1,
    reviewCount: 1284,
    freeCancellation: true,
    amenities: ['wifi', 'parking', 'pool', 'ac', 'breakfast', 'restaurant', 'gym', 'shuttle'],
    geo: { lat: 6.4281, lng: 3.4219 },
    soldOut: false,
    distanceKm: 1.2,
    loyaltyDeal: true,
  },
  {
    id: 'stay_lag_radisson',
    name: 'Radisson Ikeja GRA',
    city: 'Lagos',
    area: 'Ikeja GRA',
    star: 4,
    propertyType: 'hotel',
    sourceRail: 'BEDBANK',
    coverUrl: IMG.radisson,
    leadPriceMinor: 6_200_000, // ₦62,000
    currency: 'NGN',
    reviewScore: 8.6,
    reviewCount: 932,
    freeCancellation: true,
    amenities: ['wifi', 'parking', 'ac', 'breakfast', 'restaurant', 'gym'],
    geo: { lat: 6.5797, lng: 3.3486 },
    soldOut: false,
    distanceKm: 11.4,
  },
  {
    id: 'stay_lag_upscale',
    name: 'The Wheatbaker, Ikoyi',
    city: 'Lagos',
    area: 'Ikoyi',
    star: 5,
    propertyType: 'hotel',
    sourceRail: 'BEDBANK',
    coverUrl: IMG.upscale,
    leadPriceMinor: 32_000, // $320/night (cents)
    currency: 'USD',
    reviewScore: 9.4,
    reviewCount: 645,
    freeCancellation: true,
    amenities: ['wifi', 'parking', 'pool', 'ac', 'breakfast', 'restaurant', 'gym', 'shuttle'],
    geo: { lat: 6.4541, lng: 3.4316 },
    soldOut: false,
    distanceKm: 3.8,
    loyaltyDeal: false,
  },
  {
    id: 'stay_lag_apartment',
    name: 'Lekki Serviced Apartments',
    city: 'Lagos',
    area: 'Lekki Phase 1',
    star: 4,
    propertyType: 'apartment',
    sourceRail: 'DIRECT',
    coverUrl: IMG.apartment,
    leadPriceMinor: 4_500_000, // ₦45,000
    currency: 'NGN',
    wasPriceMinor: 5_200_000,
    reviewScore: 8.2,
    reviewCount: 417,
    freeCancellation: false,
    amenities: ['wifi', 'parking', 'ac', 'pool'],
    geo: { lat: 6.4474, lng: 3.4699 },
    soldOut: false,
    distanceKm: 9.1,
  },
  {
    id: 'stay_lag_budget',
    name: 'Yaba Comfort Inn',
    city: 'Lagos',
    area: 'Yaba',
    star: 3,
    propertyType: 'guesthouse',
    sourceRail: 'DIRECT',
    coverUrl: IMG.budget,
    leadPriceMinor: 1_850_000, // ₦18,500
    currency: 'NGN',
    reviewScore: 7.4,
    reviewCount: 256,
    freeCancellation: true,
    amenities: ['wifi', 'ac', 'parking'],
    geo: { lat: 6.5095, lng: 3.3711 },
    soldOut: false,
    distanceKm: 6.7,
  },
  {
    id: 'stay_abj_transcorp',
    name: 'Transcorp Hilton Abuja',
    city: 'Abuja',
    area: 'Maitama',
    star: 5,
    propertyType: 'hotel',
    sourceRail: 'BEDBANK',
    coverUrl: IMG.transcorp,
    leadPriceMinor: 11_500_000, // ₦115,000
    currency: 'NGN',
    reviewScore: 9.0,
    reviewCount: 1543,
    freeCancellation: true,
    amenities: ['wifi', 'parking', 'pool', 'ac', 'breakfast', 'restaurant', 'gym', 'shuttle'],
    geo: { lat: 9.0796, lng: 7.4951 },
    soldOut: false,
    distanceKm: 540,
  },
  {
    id: 'stay_abj_resort',
    name: 'Wuse Garden Resort',
    city: 'Abuja',
    area: 'Wuse 2',
    star: 4,
    propertyType: 'resort',
    sourceRail: 'DIRECT',
    coverUrl: IMG.resort,
    leadPriceMinor: 5_900_000, // ₦59,000
    currency: 'NGN',
    wasPriceMinor: 6_800_000,
    reviewScore: 8.4,
    reviewCount: 388,
    freeCancellation: true,
    amenities: ['wifi', 'parking', 'pool', 'ac', 'breakfast'],
    geo: { lat: 9.0765, lng: 7.4894 },
    soldOut: false,
    distanceKm: 535,
    loyaltyDeal: true,
  },
  {
    id: 'stay_abj_guesthouse',
    name: 'Garki Guest House',
    city: 'Abuja',
    area: 'Garki',
    star: 3,
    propertyType: 'guesthouse',
    sourceRail: 'DIRECT',
    coverUrl: IMG.guesthouse,
    leadPriceMinor: 2_400_000, // ₦24,000
    currency: 'NGN',
    reviewScore: 7.1,
    reviewCount: 142,
    freeCancellation: false,
    amenities: ['wifi', 'ac', 'parking'],
    geo: { lat: 9.0333, lng: 7.4894 },
    soldOut: false,
    distanceKm: 548,
  },
  {
    id: 'stay_soldout',
    name: 'Marina Bay Hotel (Sold out)',
    city: 'Lagos',
    area: 'Lagos Island',
    star: 4,
    propertyType: 'hotel',
    sourceRail: 'BEDBANK',
    coverUrl: IMG.radisson,
    leadPriceMinor: 5_500_000,
    currency: 'NGN',
    reviewScore: 8.0,
    reviewCount: 210,
    freeCancellation: true,
    amenities: ['wifi', 'ac', 'restaurant'],
    geo: { lat: 6.4541, lng: 3.3947 },
    soldOut: true,
    distanceKm: 2.1,
  },
  {
    id: 'stay_lag_fail',
    name: 'Surulere Grand (Demo: book fails)',
    city: 'Lagos',
    area: 'Surulere',
    star: 3,
    propertyType: 'hotel',
    sourceRail: 'BEDBANK',
    coverUrl: IMG.budget,
    leadPriceMinor: 3_200_000,
    currency: 'NGN',
    reviewScore: 7.8,
    reviewCount: 98,
    freeCancellation: true,
    amenities: ['wifi', 'ac', 'parking'],
    geo: { lat: 6.4969, lng: 3.3481 },
    soldOut: false,
    distanceKm: 7.9,
  },
];

// ── Room types, keyed by property id (with a default fallback) ────────────────
function roomsFor(propertyId: string, currency: 'NGN' | 'USD', base: number): RoomType[] {
  const cur = currency;
  return [
    {
      id: `${propertyId}_std`,
      propertyId,
      name: 'Standard Room',
      photos: [IMG.radisson, IMG.budget],
      maxOccupancy: 2,
      bedding: '1 Queen bed',
      sizeSqm: 24,
      fromPriceMinor: base,
      currency: cur,
      ratePlans: [
        {
          id: `${propertyId}_std_nonref`,
          roomTypeId: `${propertyId}_std`,
          name: 'Non-refundable',
          board: 'room_only',
          refundable: false,
          mobileOnly: false,
          pricePerNightMinor: base,
          currency: cur,
        },
        {
          id: `${propertyId}_std_flex`,
          roomTypeId: `${propertyId}_std`,
          name: 'Flexible — free cancellation',
          board: 'room_only',
          refundable: true,
          freeCancelUntil: undefined,
          mobileOnly: false,
          pricePerNightMinor: Math.round(base * 1.12),
          currency: cur,
        },
        {
          id: `${propertyId}_std_bf`,
          roomTypeId: `${propertyId}_std`,
          name: 'Flexible + breakfast',
          board: 'breakfast',
          refundable: true,
          mobileOnly: false,
          pricePerNightMinor: Math.round(base * 1.22),
          currency: cur,
        },
        {
          id: `${propertyId}_std_mobile`,
          roomTypeId: `${propertyId}_std`,
          name: 'Mobile-only rate',
          board: 'room_only',
          refundable: true,
          mobileOnly: true,
          pricePerNightMinor: Math.round(base * 0.93),
          currency: cur,
          loyaltyDiscountPct: 8,
        },
      ],
    },
    {
      id: `${propertyId}_deluxe`,
      propertyId,
      name: 'Deluxe Room',
      photos: [IMG.ekoHotel, IMG.upscale],
      maxOccupancy: 3,
      bedding: '1 King bed + sofa',
      sizeSqm: 34,
      fromPriceMinor: Math.round(base * 1.4),
      currency: cur,
      ratePlans: [
        {
          id: `${propertyId}_dlx_flex`,
          roomTypeId: `${propertyId}_deluxe`,
          name: 'Flexible — free cancellation',
          board: 'breakfast',
          refundable: true,
          mobileOnly: false,
          pricePerNightMinor: Math.round(base * 1.4),
          currency: cur,
        },
        {
          id: `${propertyId}_dlx_nonref`,
          roomTypeId: `${propertyId}_deluxe`,
          name: 'Non-refundable',
          board: 'breakfast',
          refundable: false,
          mobileOnly: false,
          pricePerNightMinor: Math.round(base * 1.28),
          currency: cur,
        },
      ],
    },
  ];
}

export const MOCK_ROOM_TYPES: Record<string, RoomType[]> = {
  stay_lag_eko: roomsFor('stay_lag_eko', 'NGN', 9_850_000),
  stay_lag_radisson: roomsFor('stay_lag_radisson', 'NGN', 6_200_000),
  stay_lag_upscale: roomsFor('stay_lag_upscale', 'USD', 32_000),
  stay_lag_apartment: roomsFor('stay_lag_apartment', 'NGN', 4_500_000),
  stay_lag_budget: roomsFor('stay_lag_budget', 'NGN', 1_850_000),
  stay_abj_transcorp: roomsFor('stay_abj_transcorp', 'NGN', 11_500_000),
  stay_abj_resort: roomsFor('stay_abj_resort', 'NGN', 5_900_000),
  stay_abj_guesthouse: roomsFor('stay_abj_guesthouse', 'NGN', 2_400_000),
  stay_soldout: roomsFor('stay_soldout', 'NGN', 5_500_000),
  stay_lag_fail: roomsFor('stay_lag_fail', 'NGN', 3_200_000),
  __default: roomsFor('__default', 'NGN', 5_000_000),
};

// ── Reviews, keyed by property id ─────────────────────────────────────────────
const SAMPLE_REVIEWS: Review[] = [
  {
    id: 'rv1',
    author: 'Chidinma A.',
    country: 'Nigeria',
    score: 9.2,
    title: 'Great stay, smooth check-in',
    body: 'Power never went off, WiFi was fast and the staff were warm. The wallet payment was instant — no card drama.',
    stayDate: '2026-05',
    roomType: 'Deluxe Room',
    hotelierResponse: 'Thank you Chidinma! We hope to host you again soon.',
  },
  {
    id: 'rv2',
    author: 'Tunde O.',
    country: 'Nigeria',
    score: 8.4,
    title: 'Good value for VI',
    body: 'Clean rooms and a solid breakfast spread. The location is perfect for business meetings.',
    stayDate: '2026-04',
    roomType: 'Standard Room',
  },
  {
    id: 'rv3',
    author: 'Sarah M.',
    country: 'United Kingdom',
    score: 9.6,
    title: 'Exceeded expectations',
    body: 'Booked from the diaspora for family. Confirmation was instant and the hotel had our record — exactly as promised.',
    stayDate: '2026-03',
    roomType: 'Deluxe Room',
  },
];

export const MOCK_REVIEWS: Record<string, Review[]> = {
  __default: SAMPLE_REVIEWS,
};

// ── Destinations ──────────────────────────────────────────────────────────────
export const MOCK_DESTINATIONS: DestinationSuggestion[] = [
  { id: 'lagos', name: 'Lagos', region: 'Lagos State, Nigeria', kind: 'city', propertyCount: 1240 },
  { id: 'abuja', name: 'Abuja', region: 'FCT, Nigeria', kind: 'city', propertyCount: 860 },
  { id: 'vi', name: 'Victoria Island', region: 'Lagos, Nigeria', kind: 'area', propertyCount: 210 },
  { id: 'ikeja', name: 'Ikeja', region: 'Lagos, Nigeria', kind: 'area', propertyCount: 180 },
  { id: 'mma', name: 'Murtala Muhammed Airport', region: 'Lagos, Nigeria', kind: 'landmark', propertyCount: 64 },
  { id: 'ph', name: 'Port Harcourt', region: 'Rivers State, Nigeria', kind: 'city', propertyCount: 320 },
  { id: 'maitama', name: 'Maitama', region: 'Abuja, Nigeria', kind: 'area', propertyCount: 95 },
];

// ── Deals ─────────────────────────────────────────────────────────────────────
export const MOCK_DEALS: Deal[] = [
  {
    id: 'deal1',
    kind: 'mobile_rate',
    title: 'Mobile-only rate',
    subtitle: 'Save up to 12% booking in the app',
    property: MOCK_PROPERTIES[0],
  },
  {
    id: 'deal2',
    kind: 'last_minute',
    title: 'Last-minute deal',
    subtitle: 'Tonight in Abuja from ₦59,000',
    property: MOCK_PROPERTIES[6],
  },
  {
    id: 'deal3',
    kind: 'loyalty',
    title: 'Paymax Stays loyalty',
    subtitle: 'Extra 8% for members',
    property: MOCK_PROPERTIES[6],
  },
];

// ── Add-ons ───────────────────────────────────────────────────────────────────
export const MOCK_ADDONS: AddOn[] = [
  {
    key: 'breakfast',
    label: 'Daily breakfast',
    description: 'Buffet breakfast for all guests',
    priceMinor: 800_000, // ₦8,000
    currency: 'NGN',
  },
  {
    key: 'late_checkout',
    label: 'Late checkout (4pm)',
    description: 'Keep your room until 4:00 pm',
    priceMinor: 500_000, // ₦5,000
    currency: 'NGN',
  },
  {
    key: 'airport_pickup',
    label: 'Airport pickup',
    description: 'Book a ride to the hotel via Paymax Transport',
    priceMinor: 1_200_000, // ₦12,000
    currency: 'NGN',
    crossSellRoute: '/mobility',
  },
  {
    key: 'travel_insurance',
    label: 'Travel insurance',
    description: 'Add trip cover via Paymax Protection',
    priceMinor: 350_000, // ₦3,500
    currency: 'NGN',
    crossSellRoute: '/insurance',
  },
];

// ── Profile (KYC/profile prefill mock) ───────────────────────────────────────
export const MOCK_PROFILE: GuestProfile = {
  fullName: 'Ada Okafor',
  email: 'ada.okafor@example.com',
  phone: '+234 803 555 0142',
  country: 'Nigeria',
  kycTier: 2,
};

export const MOCK_SAVED_IDS = ['stay_lag_eko', 'stay_abj_transcorp'];
