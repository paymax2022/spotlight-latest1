// ── Insurance (live) — dynamic form engine ──────────────────────────────────
// PURE. No `@/` imports, no React — all of it unit-testable under `node --test`.
//
// WHY THIS EXISTS
// ---------------
// Every one of MyCover's 69 products publishes its OWN required-field table, and
// no two are alike. Verified live:
//   Bastion health   → gender(Male|Female), nin(exactly 11 digits), image_url,
//                      date_of_birth(must be past), payment_plan(1..12)
//   MCG gadget       → device make/model/colour/serial, device_type enum,
//                      device_value(min ₦50,000), two image uploads
//   STI comprehensive→ 23 required of 27, incl. four utility-backed dropdowns,
//                      one of which (vehicle_model) is EMPTY until its parent
//                      make is chosen
//   Office content   → tenancy, address(>=6), office_items[] repeating rows,
//                      lga(enum of Nigerian LGAs, dependent on state)
//
// ~65 products also nest a `policy_holder` object, and 17 carry repeating array
// groups. So no screen may ever hardcode a product's fields.
//
// So no screen may ever hardcode a product's fields. Screens render a `Field[]`
// and this module decides: which fields are currently visible (dependent
// dropdowns), how to chunk them into steps so a 12-field motor form is not one
// endless scroll, whether a value passes the provider's own rules before we
// spend a network round trip on it, and what to send over the wire.

import type { Field, FieldValue, FormSchema, FormValues } from './types';

// ── Visibility (dependent fields) ───────────────────────────────────────────
/**
 * A field with `dependsOn` only exists while its controller holds the required
 * value. Hidden fields are neither rendered NOR validated NOR submitted — a
 * required field the user cannot see must never block the form.
 */
export function isActive(field: Field, values: FormValues): boolean {
  const dep = field.dependsOn;
  // No dependency, or a dependency that only governs which OPTIONS to fetch
  // (`queryParam`) rather than whether the field exists at all.
  if (!dep || dep.equals == null) return true;
  const current = values[dep.field];
  if (Array.isArray(current)) return (current as unknown[]).includes(dep.equals);
  return String(current ?? '') === dep.equals;
}

/**
 * The parent answer a remote-options lookup must be filtered by, or null when
 * there is no such dependency. Returns an EMPTY STRING when the parent exists
 * but is unanswered — the caller must then not fetch at all, because
 * `vehicle_model` with no make comes back empty and leaves the user staring at
 * a dropdown that can never be opened successfully.
 */
export function optionsQueryFor(field: Field, values: FormValues): string | null {
  const dep = field.dependsOn;
  if (!dep?.queryParam) return null;
  return asText(values[dep.field]).trim();
}

/**
 * Fields the USER sees. `hidden` fields (the `product_id` UUID of the plan they
 * picked upstream) are active and submitted but never rendered or validated —
 * asking a person to type a UUID is not a form, it is a puzzle.
 */
export function isVisible(field: Field, values: FormValues): boolean {
  return !field.hidden && isActive(field, values);
}

export function visibleFields(fields: Field[], values: FormValues): Field[] {
  return fields.filter((f) => isVisible(f, values));
}

/** Fields that go over the wire: active, hidden included. */
export function submittableFields(fields: Field[], values: FormValues): Field[] {
  return fields.filter((f) => isActive(f, values));
}

// ── Value helpers ───────────────────────────────────────────────────────────
export function isEmptyValue(v: FieldValue | undefined): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return String(v).trim() === '';
}

export function asText(v: FieldValue | undefined): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : '')).filter(Boolean).join(', ');
  if (typeof v === 'object') return '';
  return String(v);
}

export function asList(v: FieldValue | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'object') return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/** An `object` field's nested answers. */
export function asGroup(v: FieldValue | undefined): FormValues {
  return v && !Array.isArray(v) && typeof v === 'object' ? (v as FormValues) : {};
}

/** An `array` field's repeating rows. */
export function asRows(v: FieldValue | undefined): FormValues[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is FormValues => !!x && typeof x === 'object' && !Array.isArray(x));
}

// ── Validation ──────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Nigerian mobile numbers: 11 local digits (0803…) or +234 / 234 + 10 digits. */
function isValidNgPhone(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, '');
  if (/^0\d{10}$/.test(digits)) return true;
  if (/^234\d{10}$/.test(digits)) return true;
  return false;
}

/**
 * Validate ONE field against the provider's own rule set.
 *
 * The point is to fail here rather than at the insurer: a MyCover 400 costs a
 * round trip and returns machine-ish prose, while this returns the same rule in
 * the user's words, attached to the input. Everything checked here mirrors a
 * constraint the provider actually enforces.
 */
export function validateField(field: Field, value: FieldValue | undefined): string | null {
  // Composite fields validate their contents, not themselves.
  if (field.type === 'object') {
    const nested = validateAll(field.children ?? [], asGroup(value));
    const first = Object.values(nested)[0];
    return first ?? (field.required && isEmptyValue(value) ? `${field.label} is required` : null);
  }
  if (field.type === 'array') {
    const rows = asRows(value);
    const minRows = field.minRows ?? (field.required ? 1 : 0);
    if (rows.length < minRows) {
      return minRows === 1 ? `Add at least one ${singular(field.label)}` : `Add at least ${minRows}`;
    }
    if (field.maxRows != null && rows.length > field.maxRows) {
      return `You can add up to ${field.maxRows}`;
    }
    for (const row of rows) {
      const first = Object.values(validateAll(field.children ?? [], row))[0];
      if (first) return first;
    }
    return null;
  }

  const empty = isEmptyValue(value);

  if (field.required && empty) {
    return field.type === 'select' || field.type === 'multiselect'
      ? `Choose a ${field.label.toLowerCase()}`
      : field.type === 'boolean'
        ? `Choose an answer for ${field.label.toLowerCase()}`
        : `${field.label} is required`;
  }
  if (empty) return null; // optional + blank is fine; nothing else applies.

  const text = asText(value).trim();

  switch (field.type) {
    case 'email':
      if (!EMAIL_RE.test(text)) return 'Enter a valid email address';
      break;

    case 'phone':
      if (!isValidNgPhone(text)) return 'Enter a valid Nigerian phone number, e.g. 08031234567';
      break;

    case 'nin': {
      const digits = text.replace(/\D/g, '');
      const want = field.maxLength ?? field.minLength ?? 11;
      if (digits.length !== want) return `Your NIN is exactly ${want} digits`;
      if (digits !== text) return 'Your NIN should be digits only';
      break;
    }

    case 'number':
    case 'money': {
      const n = numericValue(field, text);
      if (n === null) return 'Enter a valid number';
      const min = boundInFieldUnits(field, field.min);
      const max = boundInFieldUnits(field, field.max);
      if (min != null && n < min) return `Must be at least ${describeBound(field, min)}`;
      if (max != null && n > max) return `Must be no more than ${describeBound(field, max)}`;
      break;
    }

    case 'date': {
      if (!DATE_RE.test(text)) return 'Choose a date';
      const t = Date.parse(text);
      if (Number.isNaN(t)) return 'Choose a valid date';
      const max = resolveDateBound(field.maxDate);
      const min = resolveDateBound(field.minDate);
      // `date_of_birth` carries maxDate 'today' — the provider rejects a future
      // birth date, and finding that out after a round trip is a bad way to learn it.
      if (max != null && t > max) {
        return field.maxDate === 'today' ? 'This date must be in the past' : `Must be on or before ${formatBoundDate(max)}`;
      }
      if (min != null && t < min) {
        return `Must be on or after ${formatBoundDate(min)}`;
      }
      break;
    }

    case 'select':
      if (field.options && !field.options.some((o) => o.value === text)) {
        return `Choose a ${field.label.toLowerCase()} from the list`;
      }
      break;

    case 'multiselect': {
      const list = asList(value);
      if (field.min != null && list.length < field.min) return `Choose at least ${field.min}`;
      if (field.max != null && list.length > field.max) return `Choose no more than ${field.max}`;
      if (field.options) {
        const allowed = new Set(field.options.map((o) => o.value));
        if (list.some((v) => !allowed.has(v))) return 'One of your choices is no longer available';
      }
      return null; // length rules below are for text, not for a list.
    }

    case 'boolean':
      if (text !== 'true' && text !== 'false') return `Choose an answer for ${field.label.toLowerCase()}`;
      return null;

    case 'file':
    case 'image':
      // The value here is the UPLOAD REFERENCE the provider gave us back, not
      // the local file. A raw `file://` URI means the upload never completed —
      // submitting it would fail at the insurer with a useless message.
      if (/^(file:|content:|blob:|data:)/i.test(text)) {
        return 'That file is still uploading — wait a moment and try again';
      }
      if (!text) return `Add ${field.label.toLowerCase()}`;
      return null;

    default:
      break;
  }

  // A provider-supplied regex is authoritative — it is the exact rule the
  // insurer applies, so failing it here saves a round trip and a bad message.
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(text)) return `${field.label} isn't in the expected format`;
    } catch {
      // An unparseable pattern is the schema's problem, not the user's: skip it
      // rather than blocking a form on a rule we cannot evaluate.
    }
  }

  // Length rules apply to every text-shaped field (address >= 6, first_name >= 2…).
  if (field.minLength != null && text.length < field.minLength) {
    return `Must be at least ${field.minLength} characters`;
  }
  if (field.maxLength != null && text.length > field.maxLength) {
    return `Must be ${field.maxLength} characters or fewer`;
  }
  return null;
}

/**
 * `money` fields carry KOBO bounds, so a typed naira string is scaled before it
 * is compared. `number` fields are compared as typed.
 */
function numericValue(field: Field, text: string): number | null {
  if (field.type === 'money') {
    const clean = text.replace(/[^\d.]/g, '');
    if (!clean) return null;
    const [int = '0', dec = ''] = clean.split('.');
    const kobo = Number(int) * 100 + Number((dec + '00').slice(0, 2));
    return Number.isFinite(kobo) ? Math.trunc(kobo) : null;
  }
  const n = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a declared bound into the SAME units the field's value is compared in
 * (kobo for `money`).
 *
 * The internal contract says money bounds are kobo. The provider, however,
 * states some of its own minimums in naira — `device_value >= 50000` means
 * ₦50,000. When a schema says so explicitly with `unit: 'naira'` we scale it,
 * so a ₦500 phone is rejected here rather than accepted here and rejected by
 * the insurer. Mixing these two up is a money bug, not a display bug.
 */
export function boundInFieldUnits(field: Field, bound: number | undefined): number | undefined {
  if (bound == null) return undefined;
  if (field.type === 'money' && field.unit === 'naira') return Math.trunc(bound) * 100;
  return bound;
}

function describeBound(field: Field, bound: number): string {
  if (field.type !== 'money') return bound.toLocaleString('en-NG');
  return '₦' + (bound / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

/** `'today'` → now (end of day); an ISO date → its timestamp; otherwise null. */
export function resolveDateBound(bound: string | undefined): number | null {
  if (!bound) return null;
  if (bound === 'today') {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59);
  }
  const t = Date.parse(bound);
  return Number.isFinite(t) ? t : null;
}

function formatBoundDate(t: number): string {
  return new Date(t).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Validate every VISIBLE field. Returns `{}` when the form is submittable. */
export function validateAll(fields: Field[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of visibleFields(fields, values)) {
    const err = validateField(f, values[f.name]);
    if (err) errors[f.name] = err;
  }
  return errors;
}

// ── Step chunking ───────────────────────────────────────────────────────────
export interface FormStep {
  /** Stable key so React does not remount a step when values change. */
  key: string;
  title: string;
  subtitle: string;
  fields: Field[];
}

/**
 * Fields whose name matches one of these buckets get grouped together, in this
 * order. Anything unmatched falls into "Cover details", which is where the
 * genuinely product-specific questions (cargo_value, office_items, tenancy…)
 * end up. That keeps the first step familiar on every one of the 68 products
 * even though no two schemas are alike.
 */
const BUCKETS: { key: string; title: string; subtitle: string; test: RegExp }[] = [
  {
    key: 'about-you',
    title: 'About you',
    subtitle: 'The insurer needs these to issue the policy in your name.',
    test: /^(first_?name|last_?name|middle_?name|other_?names?|full_?name|gender|sex|date_?of_?birth|dob|marital_?status|occupation|title)$/i,
  },
  {
    key: 'contact',
    title: 'How to reach you',
    subtitle: 'Your certificate and claim updates go here.',
    test: /(email|phone|msisdn|mobile|address|city|state|lga|country|postal|zip)/i,
  },
  {
    key: 'identity',
    title: 'Identity',
    subtitle: 'Required by the insurer to verify who is covered.',
    test: /(^nin$|^bvn$|nin_?number|bvn_?number|id_?type|id_?number|passport|image_?url|photo|selfie|means_?of_?id)/i,
  },
  {
    key: 'beneficiary',
    title: 'Beneficiary',
    subtitle: 'Who should be paid if a claim is made.',
    test: /(beneficiar|next_?of_?kin|nok_)/i,
  },
];

const DETAILS_STEP = {
  key: 'cover',
  title: 'Cover details',
  subtitle: 'Specific to this product — the insurer prices on these answers.',
};

/**
 * Chunk a schema into steps.
 *
 * Small schemas stay on ONE page: a 4-field form split across three screens is
 * worse than a short scroll. Only past `singlePageLimit` fields do we bucket.
 * Empty buckets are dropped, and any bucket over `maxPerStep` is split so no
 * single step becomes the endless scroll we were avoiding.
 */
export function buildSteps(
  schema: FormSchema | null | undefined,
  values: FormValues,
  opts?: { singlePageLimit?: number; maxPerStep?: number },
): FormStep[] {
  const all = visibleFields(schema?.fields ?? [], values);
  if (all.length === 0) return [];

  const singlePageLimit = opts?.singlePageLimit ?? 6;
  const maxPerStep = opts?.maxPerStep ?? 6;

  if (all.length <= singlePageLimit) {
    return [{ key: 'all', title: 'Your details', subtitle: 'The insurer needs these to cover you.', fields: all }];
  }

  // An explicit backend `group` beats our heuristic buckets.
  const grouped = all.filter((f) => f.group);
  if (grouped.length === all.length) {
    const order: string[] = [];
    const byGroup = new Map<string, Field[]>();
    for (const f of all) {
      const g = f.group as string;
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(f);
    }
    return splitOversized(
      order.map((g) => ({ key: slug(g), title: g, subtitle: '', fields: byGroup.get(g)! })),
      maxPerStep,
    );
  }

  const taken = new Set<string>();
  const steps: FormStep[] = [];

  // A nested block (`policy_holder`) or a repeating group (`office_items[]`) is
  // a screenful on its own. Mixing one in beside six scalar inputs makes a step
  // that scrolls forever, so composites always get their own step.
  const composites = all.filter((f) => f.type === 'object' || f.type === 'array');
  for (const f of composites) taken.add(f.name);

  for (const bucket of BUCKETS) {
    const fields = all.filter((f) => !taken.has(f.name) && bucket.test.test(f.name));
    if (!fields.length) continue;
    for (const f of fields) taken.add(f.name);
    steps.push({ key: bucket.key, title: bucket.title, subtitle: bucket.subtitle, fields });
  }
  const rest = all.filter((f) => !taken.has(f.name) && !composites.includes(f));
  if (rest.length) {
    steps.push({ ...DETAILS_STEP, fields: rest });
  }
  for (const f of composites) {
    steps.push({
      key: `group-${slug(f.name)}`,
      title: f.label,
      subtitle:
        f.type === 'array'
          ? 'Add every item you want covered.'
          : 'Details of the person this policy is for.',
      fields: [f],
    });
  }

  return splitOversized(steps, maxPerStep);
}

function splitOversized(steps: FormStep[], maxPerStep: number): FormStep[] {
  const out: FormStep[] = [];
  for (const step of steps) {
    if (step.fields.length <= maxPerStep) { out.push(step); continue; }
    if (step.fields.some((f) => f.type === 'object' || f.type === 'array')) {
      out.push(step);
      continue;
    }
    const parts = Math.ceil(step.fields.length / maxPerStep);
    const size = Math.ceil(step.fields.length / parts);
    for (let i = 0; i < parts; i += 1) {
      out.push({
        ...step,
        key: `${step.key}-${i + 1}`,
        title: parts > 1 ? `${step.title} (${i + 1}/${parts})` : step.title,
        fields: step.fields.slice(i * size, (i + 1) * size),
      });
    }
  }
  return out;
}

/** "Office items" → "office item", for "Add at least one …" messages. */
function singular(label: string): string {
  const l = label.toLowerCase().trim();
  return l.endsWith('ies') ? `${l.slice(0, -3)}y` : l.endsWith('s') ? l.slice(0, -1) : l;
}

function slug(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
}

/** Errors for one step only — used to gate the "Continue" button. */
export function validateStep(step: FormStep, values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of step.fields) {
    const err = validateField(f, values[f.name]);
    if (err) errors[f.name] = err;
  }
  return errors;
}

/** Index of the first step holding any of the given field names. */
export function stepIndexForField(steps: FormStep[], fieldName: string): number {
  return steps.findIndex((s) => s.fields.some((f) => f.name === fieldName));
}

/**
 * Given server-side field errors, jump the user to the earliest step that has
 * one. Returns -1 when none of the errors belong to a field we render (the
 * caller then shows them as a banner instead of silently swallowing them).
 */
export function firstErroredStep(steps: FormStep[], fieldErrors: Record<string, string>): number {
  let best = -1;
  for (const name of Object.keys(fieldErrors)) {
    const idx = stepIndexForField(steps, name);
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

// ── Prefill ─────────────────────────────────────────────────────────────────
/**
 * Seed values from the signed-in profile so a person is never asked for what
 * Paymax already holds. Only fills fields the schema actually declares, and
 * never overwrites something the user has already typed.
 */
export function prefillFromProfile(
  fields: Field[],
  profile: Partial<Record<string, string>>,
  existing: FormValues = {},
): FormValues {
  const aliases: Record<string, string[]> = {
    first_name: ['firstName', 'first_name'],
    last_name: ['lastName', 'last_name'],
    email: ['email'],
    phone_number: ['phone', 'phoneNumber', 'phone_number'],
    phone: ['phone', 'phoneNumber', 'phone_number'],
    nin: ['nin'],
    bvn: ['bvn'],
    gender: ['gender'],
    date_of_birth: ['dateOfBirth', 'date_of_birth', 'dob'],
    dob: ['dateOfBirth', 'date_of_birth', 'dob'],
    address: ['address'],
  };
  const out: FormValues = { ...existing };
  for (const f of fields) {
    if (!isEmptyValue(out[f.name])) continue;
    const keys = aliases[f.name.toLowerCase()] ?? [camel(f.name), f.name];
    for (const k of keys) {
      const v = profile[k];
      if (v != null && String(v).trim() !== '') {
        out[f.name] = String(v);
        break;
      }
    }
  }
  return out;
}

function camel(s: string): string {
  return String(s).replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
}

// ── Submission ──────────────────────────────────────────────────────────────
/**
 * Build the `inputs` map for POST /quotes and POST /policies.
 *
 * Only VISIBLE fields are sent — a hidden dependent field must not leak a stale
 * answer to the insurer. `money` fields are sent as INTEGER KOBO under the same
 * field name, because the contract says every money value crossing this boundary
 * is kobo; the Go adapter converts to the provider's naira exactly once.
 */
export function buildInputs(fields: Field[], values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of submittableFields(fields, values)) {
    const v = values[f.name];
    if (isEmptyValue(v)) continue;
    switch (f.type) {
      case 'multiselect':
        out[f.name] = asList(v);
        break;
      case 'object':
        out[f.name] = buildInputs(f.children ?? [], asGroup(v));
        break;
      case 'array':
        out[f.name] = asRows(v).map((row) => buildInputs(f.children ?? [], row));
        break;
      case 'boolean':
        out[f.name] = asText(v) === 'true';
        break;
      case 'money': {
        const kobo = numericValue(f, asText(v));
        if (kobo !== null) out[f.name] = kobo;
        break;
      }
      case 'number': {
        const n = numericValue(f, asText(v));
        if (n !== null) out[f.name] = n;
        break;
      }
      default:
        out[f.name] = asText(v).trim();
    }
  }
  return out;
}

/**
 * The declared value a percentage-priced product is rated on, in kobo, so the
 * buy screen can preview an indicative premium while the user types. Returns 0
 * when the schema has no such field.
 */
export function declaredValueKobo(fields: Field[], values: FormValues): number {
  const candidate = fields.find(
    (f) =>
      f.type === 'money' &&
      /(sum_?insured|value|amount|price|worth|cargo_?value|declared|device_?value)/i.test(f.name),
  );
  if (!candidate) return 0;
  const kobo = numericValue(candidate, asText(values[candidate.name]));
  return kobo && kobo > 0 ? kobo : 0;
}

// ── Plan families ───────────────────────────────────────────────────────────
/**
 * MyCover's buy endpoints are per FAMILY, not per product: one
 * `POST /products/bastion/buy-medisure` sells FlexiCare, FlexiCare Mini,
 * PrimeCare, Seniors and ZenCare, with `product_id` naming the plan. Plans in
 * one family therefore share a single form schema, and the purchase flow is
 * "pick a plan, then fill one form" rather than a separate form per product.
 *
 * Returns the sibling plans of `product`, itself included, in catalog order.
 */
export function familyPlans<T extends { code: string; familyCode: string; productLine: string }>(
  product: T | null | undefined,
  catalog: T[] | undefined,
): T[] {
  if (!product) return [];
  if (!catalog?.length) return [product];
  const siblings = catalog.filter(
    (p) => p.familyCode === product.familyCode && p.productLine === product.productLine,
  );
  if (!siblings.some((p) => p.code === product.code)) siblings.unshift(product);
  return siblings.length ? siblings : [product];
}

/**
 * The `product_id` the form must submit for the chosen plan. Falls back to the
 * plan's own code when the backend has not surfaced the aggregator UUID — the
 * provider will reject a non-UUID, which is the correct visible failure rather
 * than a silent purchase of the wrong plan.
 */
export function planIdValue(plan: {
  providerProductId: string | null;
  code: string;
} | null | undefined): string {
  if (!plan) return '';
  return plan.providerProductId ?? plan.code;
}
