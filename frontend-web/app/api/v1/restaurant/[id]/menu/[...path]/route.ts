import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/restaurant/:id/menu/<...>
//                  → Go /api/finance/restaurant/:id/menu/<...>
//
// Covers the four menu-management shapes the owner and admin consoles drive:
//   POST   /menu/categories
//   DELETE /menu/categories/:categoryId
//   POST   /menu/items
//   PATCH  /menu/items/:itemId
//   DELETE /menu/items/:itemId
//
// A catch-all rather than five files because the segment count varies and the
// Go side already validates the shape. Owner-only; object-level authz lives in
// the Go service (restaurant/authz.go).
async function forward(request: Request, id: string, path: string[]) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).map(encodeURIComponent).join('/');
    return proxyToGoBackend(
      request,
      `/api/finance/restaurant/${encodeURIComponent(id)}/menu/${sub}`,
    );
  } catch (err) { return handleApiError(err); }
}

type Ctx = { params: Promise<{ id: string; path: string[] }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  return forward(request, id, path);
}
export async function PATCH(request: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  return forward(request, id, path);
}
export async function DELETE(request: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  return forward(request, id, path);
}
export async function GET(request: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  return forward(request, id, path);
}
