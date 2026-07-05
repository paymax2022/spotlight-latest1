import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/onboarding/<...> → Go /api/v1/onboarding/<...>.
// Covers the merchant self-onboarding surface: catalogue reads (modules,
// merchant-types, form-schemas) and application lifecycle (create draft, save,
// submit, resubmit, get). Authed — the Go backend enforces the FEATURE_ONBOARDING
// flag, duplicate-profile guards, the guarded application state machine and the
// Idempotency-Key on every mutation (forwarded verbatim by proxyToGoBackend).
async function forward(request: Request, path: string[]) {
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/v1/onboarding/${sub}`);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
