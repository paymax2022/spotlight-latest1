import { useQuery } from '@tanstack/react-query';
import { nearby, type MapOwnEntity, type MapPoint } from '../api/maps.api';

/**
 * useNearbyOwn powers "near me" over OUR OWN records via the backend MapService,
 * which runs PostGIS ST_DWithin against merchant_locations — never a maps API.
 *
 * entityType is the merchant_locations entity_type, e.g. 'restaurant', 'estate',
 * or 'realtor_property' (these are kept in sync from their source tables by the
 * 20260626000200_merchant_locations_sync migration).
 *
 *   const { data } = useNearbyOwn('restaurant', myPin, 3000);
 */
export function useNearbyOwn(
  entityType: string,
  point: MapPoint | null | undefined,
  radiusM = 3000,
  limit = 50,
) {
  return useQuery<MapOwnEntity[]>({
    queryKey: ['maps', 'nearby', entityType, point?.lat, point?.lng, radiusM, limit],
    queryFn: () => nearby(entityType, point as MapPoint, radiusM, limit),
    enabled: !!point,
    staleTime: 30_000,
  });
}
