/**
 * POST /api/v1/realtor/ai/assist
 * Multi-task realtor AI behind one secure proxy to Claude (key server-side).
 * Body: { task: 'maintenance_triage' | 'shortlet_pricing' | 'arrears_risk', input: {...} }
 * Returns: { success, data } with a task-specific structured shape.
 */
import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_REALTOR_MODEL || 'claude-haiku-4-5-20251001';

type Task = 'maintenance_triage' | 'shortlet_pricing' | 'arrears_risk';

const PROMPTS: Record<Task, (i: any) => string> = {
  maintenance_triage: (i) =>
    `You are a property maintenance dispatcher. Classify this tenant report.\n` +
    `Report: "${i.description}"\n` +
    `Return ONLY JSON: { "suggestedCategory": one of [plumbing,electrical,ac_hvac,generator,water,roof_leak,door_lock,appliance,pest,painting,furniture,internet,security,structural,cleaning,other], "suggestedUrgency": one of [low,normal,high,emergency], "summary": string (1 sentence) }`,
  shortlet_pricing: (i) =>
    `You are a short-stay revenue manager for ${i.area || 'Lagos'}, Nigeria.\n` +
    `Recommend a nightly price band (in Naira) for a ${i.bedrooms}-bedroom shortlet.\n` +
    `Return ONLY JSON: { "nightlyLowNaira": integer, "nightlyHighNaira": integer, "rationale": string (1 sentence) }`,
  arrears_risk: (i) =>
    `You assess tenant rent-arrears risk. Monthly income (NGN): ${i.monthlyIncomeNaira}; monthly rent (NGN): ${i.monthlyRentNaira}; months tenant: ${i.tenureMonths}.\n` +
    `Return ONLY JSON: { "riskScore": integer 0-100, "band": one of [low,medium,high], "rationale": string (1 sentence) }`,
};

function toKoboFields(task: Task, parsed: any) {
  if (task === 'shortlet_pricing') {
    return {
      nightlyLow: Math.round(Number(parsed.nightlyLowNaira ?? 0)) * 100,
      nightlyHigh: Math.round(Number(parsed.nightlyHighNaira ?? 0)) * 100,
      rationale: String(parsed.rationale ?? ''),
    };
  }
  return parsed;
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.realtor()) return errorResponse('Realtor feature is not available', 503);
    await requireRequestUser(request);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return errorResponse('AI assistant is not configured', 503);

    const body = (await request.json()) as { task: Task; input: any };
    const promptFn = PROMPTS[body.task];
    if (!promptFn) return errorResponse('Unknown AI task', 400);

    const aiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: promptFn(body.input) }] }),
    });
    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => '');
      return errorResponse(`AI provider error (${aiRes.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`, 502);
    }
    const payload = await aiRes.json();
    const text: string = (payload?.content?.[0]?.text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { return errorResponse('AI returned an unparseable response', 502); }

    return successResponse({ success: true, data: toKoboFields(body.task, parsed) });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return errorResponse('Authentication required', 401);
    return handleApiError(error, 'AI assist failed');
  }
}
