// ── Insurance (live) — HTTP data layer ──────────────────────────────────────
// Speaks the internal contract only:
//   mobile → /api/v1/insurance/*  (frontend-web proxy) → Go /api/finance/insurance/*
//
// NO MOCK FALLBACK. This module never substitutes fixtures for a failed call.
// A screen that quietly shows invented data is the exact failure mode this
// rebuild removes: nobody goes looking for a bug they cannot see, and a person
// shown a policy they do not own has been lied to. Every failure surfaces as an
// `InsuranceError` and the screen renders a real error state.
//
// IRON RULE: every money mutation carries an `Idempotency-Key`.

import { api } from '@/api/client';
import { INSURANCE_API_BASE } from '../constants/insurance.constants';
import {
  mapClaim,
  mapClaims,
  mapFieldOptions,
  mapFormSchema,
  mapPolicies,
  mapPolicy,
  mapProduct,
  mapProducts,
  mapQuote,
  toInsuranceError,
  unwrap,
} from './normalize';
import type {
  Claim,
  FieldOption,
  FormSchema,
  Policy,
  Product,
  ProductLine,
  Quote,
} from './types';

/** Every call funnels through here so failures normalise in exactly one place. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toInsuranceError(err);
  }
}

/**
 * A fresh idempotency key for one money mutation. Generated ONCE per user
 * intent and reused verbatim across retries of that intent — a regenerated key
 * on retry is how a double charge happens.
 */
export function newIdempotencyKey(scope: string): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `insurance-${scope}-${rand}`;
}

// ── Catalog ─────────────────────────────────────────────────────────────────
export async function fetchProducts(line?: ProductLine | null): Promise<Product[]> {
  return call(async () => {
    const { data } = await api.get(`${INSURANCE_API_BASE}/products`, {
      params: line ? { line } : undefined,
    });
    return mapProducts(data);
  });
}

export async function fetchProduct(code: string): Promise<Product> {
  return call(async () => {
    const { data } = await api.get(`${INSURANCE_API_BASE}/products/${encodeURIComponent(code)}`);
    return mapProduct(unwrap(data) as Record<string, unknown>);
  });
}

/**
 * The product's bespoke purchase schema. Served separately from the product so
 * the browse list stays small; the detail screen prefetches it, and `GET
 * /products/:code` also embeds it when the backend has it to hand.
 */
export async function fetchFormSchema(code: string): Promise<FormSchema> {
  return call(async () => {
    const { data } = await api.get(
      `${INSURANCE_API_BASE}/products/${encodeURIComponent(code)}/schema`,
    );
    return mapFormSchema(data) ?? { fields: [] };
  });
}

// ── Dropdown options ────────────────────────────────────────────────────────
/**
 * Options for a utility-backed dropdown (109 vehicle makes, 121 colours, 193
 * nationalities, 36 states, the LGAs of one state…).
 *
 * The client asks by PRODUCT + FIELD NAME and never by URL. The schema does
 * carry a provider URL, but sending that from the device and having the backend
 * fetch it would be a request-forgery hole with the field schema as its input;
 * resolving the field name server-side keeps the set of reachable hosts closed.
 *
 * `query` carries the parent's answer for a dependent list (make → model,
 * state → LGA). Callers must not fetch a dependent list before its parent is
 * answered: the provider returns [] and the user gets a dropdown that cannot be
 * opened successfully.
 */
export async function fetchFieldOptions(args: {
  productCode: string;
  field: string;
  query?: string;
}): Promise<FieldOption[]> {
  return call(async () => {
    const { data } = await api.get(
      `${INSURANCE_API_BASE}/products/${encodeURIComponent(args.productCode)}/options/${encodeURIComponent(args.field)}`,
      { params: args.query ? { query: args.query } : undefined },
    );
    return mapFieldOptions(data);
  });
}

// ── Uploads ─────────────────────────────────────────────────────────────────
/**
 * Turn a locally-picked file into the reference the insurer expects.
 *
 * MyCover's `image_url` / `id_image_url` / `device_about_image_url` fields do
 * NOT take an arbitrary URL. The file is posted to the provider's own upload
 * endpoint, which returns an `upload_id` UUID, and THAT uuid is the field's
 * value — the provider's own sample payloads show a bare uuid there.
 *
 * We proxy through our backend rather than uploading from the device, so the
 * provider key never leaves the server. Whatever reference comes back (an
 * upload id, or a URL if the backend chose to host it) is what we store.
 *
 * BACKEND DEPENDENCY: `POST /api/v1/insurance/uploads`. Until it exists this
 * rejects, and the field shows a real upload error rather than letting a
 * `file://` URI through to a purchase that would be refused.
 */
export async function uploadInsuranceFile(file: {
  uri: string;
  name: string;
  mimeType?: string;
  purpose?: string;
}): Promise<string> {
  return call(async () => {
    const form = new FormData();
    // React Native's FormData takes this shape; the web build takes a Blob, so
    // fetch the local URI first when we are running in a browser.
    if (file.uri.startsWith('blob:') || file.uri.startsWith('data:')) {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append(
        'file',
        {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? guessMime(file.name),
        } as unknown as Blob,
      );
    }
    if (file.purpose) form.append('purpose', file.purpose);

    const { data } = await api.post(`${INSURANCE_API_BASE}/uploads`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    });
    const body = unwrap(data) as { upload_id?: unknown; uploadId?: unknown; id?: unknown; url?: unknown } | string | null;
    const reference =
      typeof body === 'string'
        ? body
        : body?.upload_id ?? body?.uploadId ?? body?.id ?? body?.url;
    if (!reference) {
      throw {
        response: {
          status: 502,
          data: {
            error: {
              code: 'UPLOAD_NO_REFERENCE',
              message: 'That file uploaded, but the insurer did not return a reference for it.',
            },
          },
        },
      };
    }
    return String(reference);
  });
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'pdf': return 'application/pdf';
    default: return 'image/jpeg';
  }
}

// ── Quote ───────────────────────────────────────────────────────────────────
/**
 * Price this product for these answers. The premium comes back from the server
 * for BOTH flat and percentage products — the client never computes a binding
 * price, it only ever renders one.
 */
export async function createQuote(args: {
  productCode: string;
  inputs: Record<string, unknown>;
}): Promise<Quote> {
  return call(async () => {
    const { data } = await api.post(`${INSURANCE_API_BASE}/quotes`, {
      product_code: args.productCode,
      inputs: args.inputs,
    });
    return mapQuote(data);
  });
}

// ── Purchase ────────────────────────────────────────────────────────────────
export async function purchasePolicy(args: {
  quoteRef: string;
  productCode: string;
  inputs: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<Policy> {
  return call(async () => {
    const { data } = await api.post(
      `${INSURANCE_API_BASE}/policies`,
      {
        quote_ref: args.quoteRef,
        product_code: args.productCode,
        inputs: args.inputs,
      },
      { headers: { 'Idempotency-Key': args.idempotencyKey } },
    );
    return mapPolicy(unwrap(data) as Record<string, unknown>);
  });
}

// ── Policies ────────────────────────────────────────────────────────────────
export async function fetchPolicies(): Promise<Policy[]> {
  return call(async () => {
    const { data } = await api.get(`${INSURANCE_API_BASE}/policies`);
    return mapPolicies(data);
  });
}

export async function fetchPolicy(id: string): Promise<Policy> {
  return call(async () => {
    const { data } = await api.get(`${INSURANCE_API_BASE}/policies/${encodeURIComponent(id)}`);
    return mapPolicy(unwrap(data) as Record<string, unknown>);
  });
}

export async function cancelPolicy(args: { id: string; reason: string }): Promise<Policy> {
  return call(async () => {
    const { data } = await api.post(
      `${INSURANCE_API_BASE}/policies/${encodeURIComponent(args.id)}/cancel`,
      { reason: args.reason },
    );
    return mapPolicy(unwrap(data) as Record<string, unknown>);
  });
}

export async function fetchCertificateUrl(id: string): Promise<string | null> {
  return call(async () => {
    const { data } = await api.get(
      `${INSURANCE_API_BASE}/policies/${encodeURIComponent(id)}/certificate`,
    );
    const body = unwrap(data) as Record<string, unknown> | string | null;
    if (typeof body === 'string') return body || null;
    const url = body?.url;
    return url ? String(url) : null;
  });
}

// ── Claims ──────────────────────────────────────────────────────────────────
export async function fetchClaims(): Promise<Claim[]> {
  return call(async () => {
    const { data } = await api.get(`${INSURANCE_API_BASE}/claims`);
    return mapClaims(data);
  });
}

export async function fetchClaim(id: string): Promise<Claim> {
  return call(async () => {
    const { data } = await api.get(`${INSURANCE_API_BASE}/claims/${encodeURIComponent(id)}`);
    return mapClaim(unwrap(data) as Record<string, unknown>);
  });
}

export async function fileClaim(args: {
  policyId: string;
  lossEventAt: string;
  amountKobo: number;
  description: string;
  inputs?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<Claim> {
  return call(async () => {
    const { data } = await api.post(
      `${INSURANCE_API_BASE}/claims`,
      {
        policy_id: args.policyId,
        loss_event_at: args.lossEventAt,
        amount_kobo: Math.trunc(args.amountKobo),
        description: args.description,
        inputs: args.inputs ?? {},
      },
      { headers: { 'Idempotency-Key': args.idempotencyKey } },
    );
    return mapClaim(unwrap(data) as Record<string, unknown>);
  });
}

export async function addClaimEvidence(args: {
  claimId: string;
  files: { name: string; uri: string; mimeType?: string }[];
}): Promise<Claim> {
  return call(async () => {
    const { data } = await api.post(
      `${INSURANCE_API_BASE}/claims/${encodeURIComponent(args.claimId)}/evidence`,
      {
        files: args.files.map((f) => ({
          name: f.name,
          uri: f.uri,
          mime_type: f.mimeType ?? null,
        })),
      },
    );
    return mapClaim(unwrap(data) as Record<string, unknown>);
  });
}
