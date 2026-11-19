// The lucide glyph for a provider type. Lives apart from portals.ts, which stays
// free of React Native imports so node:test can run it.

import {
  Stethoscope, PawPrint, Pill, FlaskConical, UtensilsCrossed, Bike, Car, ShoppingBag,
  CalendarDays, Building2, KeyRound, Users, HeartHandshake, Bus, type LucideIcon,
} from 'lucide-react-native';
import type { ProviderType } from './gate';

const ICONS: Record<ProviderType, LucideIcon> = {
  doctor: Stethoscope,
  vet: PawPrint,
  pharmacy: Pill,
  lab: FlaskConical,
  restaurant: UtensilsCrossed,
  rider: Bike,
  driver: Car,
  marketplace_seller: ShoppingBag,
  event_organiser: CalendarDays,
  estate_manager: Building2,
  property_manager: KeyRound,
  association_creator: Users,
  crowdfunding_creator: HeartHandshake,
  bus_owner: Bus,
};

export function PortalIcon({ type, size = 20, color, strokeWidth = 2 }: {
  type: ProviderType;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const Icon = ICONS[type];
  if (!Icon) return null;
  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}
