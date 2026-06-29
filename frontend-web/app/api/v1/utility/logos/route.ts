import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { listUtilityProviderLogos } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityReader, utilityUnavailableResponse } from '../_utils';

// Returns the VTPass provider logos for a category: [{ serviceID, name, image }].
// Cached in-memory (1h) so we don't hit VTPass on every screen load. Auth-only
// (read), no KYC tier. Clients fall back to brand logos when this is empty.
type Cached = { at: number; services: unknown[] };
const cache = new Map<string, Cached>();
const TTL_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityReader(request);
    const url = new URL(request.url);
    const category = parseUtilityCategory(url.searchParams.get('category'));
    if (!category) return errorResponse('category is required.', 400);

    const hit = cache.get(category);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return successResponse({ services: hit.services });
    }

    const services = await listUtilityProviderLogos(category);
    if (services.length) cache.set(category, { at: Date.now(), services });
    return successResponse({ services });
  } catch (err) {
    return handleApiError(err);
  }
}
