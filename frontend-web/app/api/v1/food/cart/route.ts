import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { errorResponse, successResponse, handleApiError } from '@/src/lib/api/responses';

// Cross-device cart persistence for the mobile food module.
//
// GET  /api/v1/food/cart → the caller's saved cart (null when none)
// POST /api/v1/food/cart → upsert the caller's cart
//
// Backed directly by the `food_carts` table (migration
// 20261112000000_food_cart_persistence.sql), NOT proxied to Go: the cart is a
// draft, not a money path. Nothing here is trusted at checkout — Go's PlaceOrder
// re-prices every line from the live menu, so a tampered cart cannot move money.
// That is also why this route does no price validation.
//
// The table's RLS scopes rows to auth.uid(); this handler uses the service-role
// client and constrains every query by the token-verified user id itself, so the
// isolation guarantee is preserved without depending on a user-session client.
//
// Prior to this file the mobile client's saveCartToServer/loadCartFromServer
// always failed (no such route anywhere) and swallowed the error, silently
// degrading to local-storage-only.

type SavedCart = {
  restaurantId: string | null;
  restaurantName: string | null;
  packages: unknown[];
  activePackageId: string | null;
};

export async function GET(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('food_carts')
      .select('restaurant_id, restaurant_name, packages, active_package_id, updated_at')
      .eq('customer_id', user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return successResponse({ data: null });

    return successResponse({
      data: {
        restaurantId: data.restaurant_id,
        restaurantName: data.restaurant_name,
        packages: data.packages ?? [],
        activePackageId: data.active_package_id,
        updatedAt: data.updated_at,
      } satisfies SavedCart & { updatedAt: string },
    });
  } catch (err) { return handleApiError(err); }
}

export async function POST(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => null)) as Partial<SavedCart> | null;
    if (!body || typeof body !== 'object') return errorResponse('Invalid cart payload.', 400);
    if (body.packages !== undefined && !Array.isArray(body.packages)) {
      return errorResponse('`packages` must be an array.', 400);
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('food_carts')
      .upsert(
        {
          customer_id: user.id,
          restaurant_id: body.restaurantId ?? null,
          restaurant_name: body.restaurantName ?? null,
          packages: body.packages ?? [],
          active_package_id: body.activePackageId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'customer_id' }, // one active cart per customer (UNIQUE)
      );

    if (error) throw error;
    return successResponse({ saved: true });
  } catch (err) { return handleApiError(err); }
}

// Clearing the cart after a successful order. The mobile client's
// clearPersistedCart() currently only wipes local storage; this gives it a
// server-side counterpart to call.
export async function DELETE(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { error } = await supabase.from('food_carts').delete().eq('customer_id', user.id);
    if (error) throw error;
    return successResponse({ cleared: true });
  } catch (err) { return handleApiError(err); }
}
