/**
 * POST /api/v1/realtor/ai/listing-copy
 * AI listing assistant — generates a structured listing draft (title,
 * description, tags, price band) for a unit. Proxies to the Anthropic (Claude)
 * Messages API server-side so the API key never reaches the mobile client.
 *
 * Request body: { propertyType, area, bedrooms, bathrooms, amenities[], highlights? }
 * Response: { success, data: ListingCopySuggestion }   (prices in kobo)
 */
import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_REALTOR_MODEL || 'claude-haiku-4-5-20251001';

interface Body {
  propertyType?: string;
  area?: string;
  bedrooms?: number;
  bathrooms?: number;
  amenities?: string[];
  highlights?: string;
}

function buildPrompt(b: Body): string {
  const amenities = (b.amenities ?? []).join(', ') || 'none specified';
  return [
    'You are a Nigerian real-estate copywriter and pricing analyst.',
    'Write a marketplace listing for the property below and recommend a price band.',
    '',
    `Property type: ${b.propertyType ?? 'apartment'}`,
    `Area: ${b.area ?? 'Lagos'}`,
    `Bedrooms: ${b.bedrooms ?? 0}`,
    `Bathrooms: ${b.bathrooms ?? 0}`,
    `Amenities: ${amenities}`,
    b.highlights ? `Owner highlights: ${b.highlights}` : '',
    '',
    'Respond with ONLY a JSON object (no markdown, no prose) of this exact shape:',
    '{',
    '  "title": string,',
    '  "description": string (2-4 sentences, warm and factual, no emojis),',
    '  "tags": string[] (3-6 short tags),',
    '  "priceLowNaira": integer (annual rent or sale price, in Naira),',
    '  "priceHighNaira": integer (in Naira, >= priceLowNaira),',
    '  "rationale": string (1 sentence on the price basis)',
    '}',
  ].filter(Boolean).join('\n');
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.realtor()) return errorResponse('Realtor feature is not available', 503);
    await requireRequestUser(request);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return errorResponse('AI assistant is not configured', 503);

    const body = (await request.json()) as Body;

    const aiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: buildPrompt(body) }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => '');
      return errorResponse(`AI provider error (${aiRes.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`, 502);
    }

    const payload = await aiRes.json();
    const text: string = (payload?.content?.[0]?.text ?? '').trim();

    // The model is asked for raw JSON; tolerate stray fencing just in case.
    const jsonStr = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return errorResponse('AI returned an unparseable response', 502);
    }

    const low = Math.round(Number(parsed.priceLowNaira ?? 0)) * 100;   // → kobo
    const high = Math.round(Number(parsed.priceHighNaira ?? 0)) * 100; // → kobo

    return successResponse({
      success: true,
      data: {
        title: String(parsed.title ?? ''),
        description: String(parsed.description ?? ''),
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
        priceLow: low,
        priceHigh: Math.max(high, low),
        rationale: String(parsed.rationale ?? ''),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to generate listing copy');
  }
}
