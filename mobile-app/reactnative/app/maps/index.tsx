import NearbyMerchantsScreen from '@/features/mobility/screens/NearbyMerchantsScreen';

// Route: /maps — demonstrates the full MapService loop (pin capture →
// merchant_locations → PostGIS near-me) for restaurant/estate/realtor.
export default function MapsRoute() {
  return <NearbyMerchantsScreen />;
}
