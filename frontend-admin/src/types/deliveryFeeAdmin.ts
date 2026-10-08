// Delivery-fee admin console types.
// The Go restaurant module exposes a delivery-fee configuration that drives the
// quoted delivery fee for an order. A config can be resolved at three scopes:
//   restaurant — an explicit per-restaurant override
//   global     — the platform-wide default override
//   default    — hard-coded fallback when neither override exists
// All money fields are integer KOBO (₦1 = 100 kobo). Never floats.
// Fee formula (must match backend + the client-side live preview):
// night_fee applies when the delivery hour falls in the [night_start_hour, night_end_hour)
// window (wraps past midnight).

// Where the resolved config came from.
export type DeliveryConfigScope = 'restaurant' | 'global' | 'default';

// The editable delivery-fee configuration. Money fields are integer kobo.
export interface DeliveryFeeConfig {
  base_fee_kobo: number;        // flat base fee
  free_distance_km: number;     // distance included before per-km charges
  per_km_kobo: number;          // charge per km after free_distance_km
  free_minutes: number;         // ETA minutes included before per-minute charges
  per_minute_kobo: number;      // charge per minute after free_minutes
  demand_multiplier: number;
  night_fee_kobo: number;       // surcharge applied during the night window
  night_start_hour: number;     // night window start hour (0-23, inclusive)
  night_end_hour: number;
  weather_fee_kobo: number;     // bad-weather surcharge
  handling_fee_kobo: number;    // packaging/handling surcharge
  promo_discount_kobo: number;  // promotional discount subtracted from the fee
  avg_speed_kmph: number;       // assumed average speed for ETA derivation (>0)
  road_factor: number;          // straight-line → road distance multiplier (>=1)
  min_fee_kobo: number;         // floor (clamp lower bound)
  max_fee_kobo: number;
  active: boolean;              // whether this config is enabled
}

// GET /restaurant/admin/delivery-config?restaurant_id=  response shape.
export interface GetDeliveryConfigResponse {
  scope: DeliveryConfigScope;
  config: DeliveryFeeConfig;
}

// PUT /restaurant/admin/delivery-config  request body shape. restaurant_id null
// override.
export interface PutDeliveryConfigBody extends DeliveryFeeConfig {
  restaurant_id?: string | null;
}
